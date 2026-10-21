import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
process.env.JWT_SECRET = 'expenses-fixture-'.repeat(8);
process.env.ADMIN_API_KEY = 'fixture-expense-admin';
process.env.DEVICE_HASH_PEPPER = 'expense-test-pepper';
const { createSalesService } = await import('../src/sales.js');
const { createQuiltedAdminRouter } = await import('../src/quiltedAdmin.js');
const db=new PGlite();
for(const name of ['001_init.sql','009_qt_optimizer_licenses.sql','010_qt_sales_ledger.sql','012_qt_expenses.sql']) await db.exec(await fs.readFile(new URL('../migrations/'+name,import.meta.url),'utf8'));
const adapt=c=>({query:async(sql,args)=>{const r=await c.query(sql,args);return {rows:r.rows,rowCount:r.rows.length};}});
const execute=adapt(db).query,transaction=fn=>db.transaction(c=>fn(adapt(c)));
const now=()=>new Date('2026-10-20T01:30:00Z');
const service=createSalesService({execute,transaction,now});
const guild='111111111111111111',other='222222222222222222',actor='333333333333333333';
let interaction=400000000000000000n;
const expense=(extras={})=>({amount:20,description:'Railway hosting',interactionId:String(++interaction),...extras});
const app=express();app.use(express.json());app.use('/v1/qt-admin',createQuiltedAdminRouter({execute,transaction}));
const server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
async function api(path,{body,status=200,key='fixture-expense-admin',who=actor}={}){
 const r=await fetch(`http://127.0.0.1:${server.address().port}/v1/qt-admin/sales/guilds/${guild}${path}`,{method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Admin-Key':key,'X-Admin-Actor':who},...(body?{body:JSON.stringify(body)}:{})});
 const data=await r.json();assert.equal(r.status,status,JSON.stringify(data));return data;
}
let p1,p2,e1;
test('expense API on production mount authenticates and records exact cents without touching sales or licenses',async()=>{
 await api('/expenses',{key:'wrong',status:403});await api('/expenses',{who:'discord-self:'+actor,status:400});
 p1=(await service.addProduct(guild,actor,{name:'Utility',price:100,cost:10})).product.id;
 p2=(await service.addProduct(guild,actor,{name:'Manual',price:25})).product.id;
 const result=await api('/expenses',{body:expense({amount:20.01,spentOn:'2026-10-19',paymentReference:'RECEIPT-1'})});
 e1=result.expense.id;assert.equal(result.expense.amountCents,2001);assert.equal(result.expense.category,'Other');assert.equal(result.expense.productId,null);
 assert.equal((await execute('SELECT count(*)::int n FROM qt_sales')).rows[0].n,0);
 assert.equal((await execute('SELECT count(*)::int n FROM qt_licenses')).rows[0].n,0);
});
test('expense retry deduplicates exact interactions and references; changed details or actor cannot reuse it',async()=>{
 const body=expense({amount:'0.10',description:'Test cents',paymentReference:'CENTS',spentOn:'2026-10-18'});
 const [first,second]=await Promise.all([service.addExpense(guild,actor,body),service.addExpense(guild,actor,body)]);
 assert.equal(first.expense.id,second.expense.id);assert.equal(second.duplicate,true);assert.equal(first.expense.amountCents,10);
 await assert.rejects(()=>service.addExpense(guild,actor,{...body,amount:1}),e=>e.code==='QT-EXPENSE-RETRY');
 await assert.rejects(()=>service.addExpense(guild,other,body),e=>e.code==='QT-EXPENSE-RETRY');
 await assert.rejects(()=>service.addExpense(guild,actor,expense({paymentReference:'cents'})),e=>e.code==='QT-EXPENSE-DUPLICATE');
 await service.voidExpense(guild,actor,first.expense.id,'Remove test cents');
});
test('dashboard subtracts all expenses once; product filters include only linked expenses and expense-only days are negative',async()=>{
 await service.confirm(guild,actor,{productId:p1,fee:2,interactionId:String(++interaction),soldOn:'2026-10-19'});
 await service.addExpense(guild,actor,expense({amount:10,productId:p1,spentOn:'2026-10-18',category:'Software'}));
 await service.addExpense(guild,actor,expense({amount:30,productId:p2,spentOn:'2026-10-17',category:'Equipment'}));
 const d=await service.dashboard(guild,actor,{period:'7d'});
 assert.equal(d.totals.revenueCents,10000);assert.equal(d.totals.saleProfitCents,8800);
 assert.equal(d.totals.expenseCents,6001);assert.equal(d.totals.expenseCount,3);assert.equal(d.totals.profitCents,2799);
 assert.equal(d.series.reduce((n,x)=>n+x.profitCents,0),2799);
 assert.equal(d.series.find(x=>x.date==='2026-10-18').profitCents,-1000);
 assert.equal(d.series.find(x=>x.date==='2026-10-19').profitCents,6799);
 const p=await service.dashboard(guild,actor,{period:'7d',productId:p1});
 assert.equal(p.totals.expenseCents,1000);assert.equal(p.totals.profitCents,7800);assert.match(p.expenseScope,/general expenses excluded/i);
 const loss=await service.dashboard(guild,actor,{period:'7d',productId:p2});assert.equal(loss.totals.orders,0);assert.equal(loss.totals.profitCents,-3000);
 assert.equal((await service.expenses(guild,actor,{productId:p1})).expenses.length,1);
});
test('voiding preserves audit history and restores net profit; retry and correction are safe',async()=>{
 await assert.rejects(()=>service.voidExpense(other,actor,e1,'Wrong server'),e=>e.status===404);
 const result=await api(`/expenses/${e1}/void`,{body:{reason:'Wrong receipt amount'}});assert.equal(result.alreadyVoided,false);
 assert.equal((await service.voidExpense(guild,actor,e1,'Retry')).alreadyVoided,true);
 assert.equal((await service.dashboard(guild,actor)).totals.profitCents,4800);
 assert.equal((await execute("SELECT count(*)::int n FROM audit_logs WHERE action='qt.sales.expense_voided' AND target=$1",[e1])).rows[0].n,1);
 assert.equal((await service.expenses(guild,actor)).expenses.some(x=>x.id===e1),false);
 assert.equal((await service.expenses(guild,actor,{includeVoided:true})).expenses.some(x=>x.id===e1),true);
 const corrected=await service.addExpense(guild,actor,expense({amount:5,paymentReference:'receipt-1',spentOn:'2026-10-19'}));assert.equal(corrected.duplicate,false);
});
test('validation, server isolation, archived products, period boundaries and persistence',async()=>{
 for(const extra of [{amount:0},{amount:-1},{amount:0.001},{amount:1000000.01},{amount:null},{description:''},{description:'bad\nvalue'},{category:''},{spentOn:'2026-10-20'},{spentOn:'2026-02-30'},{productId:'bad'}])await assert.rejects(()=>service.addExpense(guild,actor,expense(extra)),e=>e.status===400);
 await assert.rejects(()=>service.addExpense(other,actor,expense({productId:p1})),e=>e.status===404);
 await assert.rejects(()=>service.expenses(other,actor,{productId:p1}),e=>e.status===404);
 await assert.rejects(()=>service.expenses(guild,actor,{limit:100}),e=>e.status===400);
 await service.editProduct(guild,actor,p1,{active:false});
 await service.addExpense(guild,actor,expense({amount:2,productId:p1,spentOn:'2026-09-01'}));
 const fresh=createSalesService({execute,transaction,now});
 assert.equal((await fresh.dashboard(guild,actor,{period:'7d'})).totals.expenseCents,4500);
 assert.equal((await fresh.dashboard(guild,actor,{period:'all'})).totals.expenseCents,4700);
 assert.equal((await fresh.dashboard(other,actor)).totals.expenseCents,0);
});
test('expense audit failure rolls back the purchase and its reporting impact',async()=>{
 const badTx=fn=>transaction(c=>fn({query:(sql,args)=>{if(sql.startsWith('INSERT INTO audit_logs'))throw new Error('fixture audit failure');return c.query(sql,args);}}));
 const svc=createSalesService({execute,transaction:badTx,now});const body=expense();
 await assert.rejects(()=>svc.addExpense(guild,actor,body),/fixture audit failure/);
 assert.equal((await execute('SELECT * FROM qt_sales_expenses WHERE interaction_id=$1',[body.interactionId])).rows.length,0);
});
test.after(async()=>{await new Promise(r=>server.close(r));await db.close();});

test('upgrade from the full existing schema preserves sales and products',async()=>{
 const old=new PGlite();
 try {
  const dir=new URL('../migrations/',import.meta.url);
  for(const name of (await fs.readdir(dir)).filter(n=>n.endsWith('.sql')&&n<'012_').sort())await old.exec(await fs.readFile(new URL(name,dir),'utf8'));
  const id='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  await old.query('INSERT INTO qt_sales_products(id,guild_id,name,name_key,price_cents,cost_cents,created_by) VALUES($1,$2,$3,$4,$5,$6,$7)',[id,guild,'Existing Utility','existing utility',1500,0,actor]);
  await old.query('INSERT INTO qt_sales(id,guild_id,product_id,product_name,unit_price_cents,unit_cost_cents,quantity,fee_cents,interaction_id,request_hash,recorded_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)',['bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb',guild,id,'Existing Utility',1500,0,1,50,'999999999999999999','fixture-hash',actor]);
  await old.exec(await fs.readFile(new URL('012_qt_expenses.sql',dir),'utf8'));
  assert.equal((await old.query('SELECT unit_price_cents FROM qt_sales')).rows[0].unit_price_cents,1500);
  assert.equal((await old.query('SELECT name FROM qt_sales_products')).rows[0].name,'Existing Utility');
  assert.equal((await old.query('SELECT count(*)::int n FROM qt_sales_expenses')).rows[0].n,0);
 } finally {await old.close();}
});
