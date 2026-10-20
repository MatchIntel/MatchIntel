import { Router } from 'express';
import { query, tx } from './db.js';
import { requireAdmin } from './auth.js';
import { createQtKey } from './qtLicenses.js';
import { decryptLicenseKey, encryptLicenseKey, randomUuid, sha256 } from './security.js';

const fail = (status, code, message) => { throw Object.assign(new Error(message), { status, code }); };
const idPattern = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const unused = "status='active' AND activated_at IS NULL AND device_hash IS NULL AND discord_user_id IS NULL AND (expires_at IS NULL OR expires_at>NOW())";
function actorId(value) {
  if (typeof value !== 'string' || !/^\d{15,25}$/.test(value)) fail(400, 'QT-WEBSITE-ACTOR', 'A real staff Discord actor ID is required.');
  return value;
}
function requestBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) fail(400, 'QT-WEBSITE-INPUT', 'Invalid generation request.');
  if (!Number.isInteger(body.count) || body.count < 1 || body.count > 1000) fail(400, 'QT-WEBSITE-COUNT', 'Choose 1 to 1000 keys per batch.');
  if (!['trial', 'lifetime'].includes(body.plan)) fail(400, 'QT-PLAN', 'Choose trial or lifetime.');
  const days = body.trialDays ?? 3;
  if (body.plan === 'trial' && (!Number.isInteger(days) || days < 1 || days > 30)) fail(400, 'QT-DURATION', 'Choose 1 to 30 days for timed keys.');
  if (body.maxDevices != null && body.maxDevices !== 1) fail(400, 'QT-ONE-PC', 'Each website key is locked to one PC.');
  if (body.discordUserId != null || body.discordUsername != null) fail(400, 'QT-WEBSITE-OWNER', 'Website batches have no Discord customer. Use /genkey for linked keys.');
  if (typeof body.requestId !== 'string' || !/^\d{15,25}$/.test(body.requestId)) fail(400, 'QT-WEBSITE-REQUEST', 'A Discord interaction ID is required to prevent duplicate batches.');
  if (body.note != null && (typeof body.note !== 'string' || body.note.trim().length > 500 || /[\u0000-\u001f\u007f]/.test(body.note))) fail(400, 'QT-WEBSITE-NOTE', 'Use a plain-text note up to 500 characters.');
  return { count: body.count, plan: body.plan, durationSeconds: body.plan === 'trial' ? days * 86400 : null, note: (body.note ?? '').trim(), requestId: body.requestId };
}
const summary = row => ({ id: row.id, plan: row.plan, durationSeconds: Number(row.duration_seconds) || null, count: row.key_count, note: row.note, createdBy: row.created_by, createdAt: row.created_at,
  ...(row.remaining_count == null ? {} : { remainingCount: Number(row.remaining_count), unusedCount: Number(row.unused_count), activatedCount: Number(row.activated_count) }) });

export function createWebsiteKeyService({ execute = query, transaction = tx } = {}) {
  const audit = (c, action, actor, batchId, details) => c.query('INSERT INTO audit_logs(id,action,actor,target,details) VALUES($1,$2,$3,$4,$5)', [randomUuid(), 'qt.website_keys.' + action, actor, batchId, JSON.stringify(details)]);
  async function get(c, id, unusedOnly) {
    const batch = (await c.query('SELECT * FROM qt_website_key_batches WHERE id=$1', [id])).rows[0];
    if (!batch) fail(404, 'QT-WEBSITE-BATCH-NOT-FOUND', 'Website key batch not found. Use /websitebatches.');
    const result = await c.query('SELECT key_ciphertext FROM qt_licenses WHERE website_batch_id=$1' + (unusedOnly ? ' AND ' + unused : '') + ' ORDER BY website_batch_position,id', [id]);
    const keys = result.rows.map(row => decryptLicenseKey(row.key_ciphertext));
    if (keys.some(key => !/^QT-(?:[A-F0-9]{4}-){7}[A-F0-9]{4}$/.test(key ?? ''))) fail(503, 'QT-WEBSITE-DECRYPT', 'Cannot recover this batch. Check the unchanged LICENSE_KEY_ENCRYPTION_KEY/JWT_SECRET values; no replacement keys were generated.');
    return { batch: summary(batch), keys, exportedCount: keys.length, unusedOnly };
  }
  return {
    async generate(body, actor) {
      actor = actorId(actor);
      const input = requestBody(body), { requestId, ...spec } = input, hash = sha256(JSON.stringify(spec));
      return transaction(async c => {
        // A retry, even after a timeout, recovers this batch rather than minting more keys.
        await c.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', ['qt-website-keys:' + requestId]);
        const previous = (await c.query('SELECT * FROM qt_website_key_batches WHERE request_id=$1', [requestId])).rows[0];
        if (previous) {
          if (previous.created_by !== actor || previous.request_hash !== hash) fail(409, 'QT-WEBSITE-RETRY', 'This generation request already belongs to a different batch.');
          const result = await get(c, previous.id, true);
          await audit(c, 'retry_export', actor, previous.id, { count: result.exportedCount });
          return { ...result, duplicate: true };
        }
        const batchId = randomUuid();
        await c.query('INSERT INTO qt_website_key_batches(id,request_id,request_hash,plan,duration_seconds,key_count,note,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)', [batchId, requestId, hash, spec.plan, spec.durationSeconds, spec.count, spec.note, actor]);
        const rows = Array.from({ length: spec.count }, (_, index) => {
          const key = createQtKey();
          return { id: randomUuid(), key_hash: sha256(key), key_prefix: key.slice(0, 12), key_ciphertext: encryptLicenseKey(key), position: index + 1 };
        });
        // One atomic insert; every key still uses the existing one-device activation path.
        await c.query(`INSERT INTO qt_licenses(id,key_hash,key_prefix,key_ciphertext,plan,duration_seconds,discord_user_id,discord_username,issued_by_discord_id,note,issuance_source,website_batch_id,website_batch_position)
          SELECT k.id,k.key_hash,k.key_prefix,k.key_ciphertext,$2,$3,NULL,NULL,$4,$5,'website',$6,k.position
          FROM jsonb_to_recordset($1::jsonb) AS k(id uuid,key_hash text,key_prefix text,key_ciphertext text,position integer)`, [JSON.stringify(rows), spec.plan, spec.durationSeconds, actor, spec.note, batchId]);
        await audit(c, 'generate', actor, batchId, { count: spec.count, plan: spec.plan, durationSeconds: spec.durationSeconds, maxDevices: 1 });
        return { ...(await get(c, batchId, true)), duplicate: false };
      });
    },
    async export(id, actor, { unusedOnly = true } = {}) {
      actor = actorId(actor);
      if (!idPattern.test(String(id))) fail(400, 'QT-WEBSITE-BATCH-ID', 'Use a full batch ID from /websitebatches.');
      if (typeof unusedOnly !== 'boolean') fail(400, 'QT-WEBSITE-FILTER', 'unusedOnly must be true or false.');
      return transaction(async c => {
        const result = await get(c, id, unusedOnly);
        await audit(c, 'export', actor, id, { count: result.exportedCount, unusedOnly });
        return result;
      });
    },
    async list(actor, { limit = 10 } = {}) {
      actorId(actor);
      if (!Number.isInteger(limit) || limit < 1 || limit > 20) fail(400, 'QT-WEBSITE-LIMIT', 'Use a limit from 1 to 20.');
      const r = await execute(`SELECT b.*, (SELECT count(*)::int FROM qt_licenses WHERE website_batch_id=b.id) AS remaining_count,
        (SELECT count(*)::int FROM qt_licenses WHERE website_batch_id=b.id AND ${unused}) AS unused_count,
        (SELECT count(*)::int FROM qt_licenses WHERE website_batch_id=b.id AND activated_at IS NOT NULL) AS activated_count
        FROM qt_website_key_batches b ORDER BY b.created_at DESC,b.id LIMIT $1`, [limit]);
      return { batches: r.rows.map(summary) };
    }
  };
}

export function createWebsiteKeyRouter({ service = createWebsiteKeyService() } = {}) {
  const router = Router(); router.use(requireAdmin);
  router.use((_req, res, next) => { res.setHeader('Cache-Control', 'no-store'); next(); });
  const handle = fn => async (req, res) => {
    try { res.json(await fn(req, actorId(req.headers['x-admin-actor']))); }
    catch (e) { res.status(e.status || 500).json({ code: e.status ? e.code : 'QT-WEBSITE-KEYS', message: e.status ? e.message : 'Website key generation is temporarily unavailable. Use /websitebatches to recover an existing batch before trying again.' }); }
  };
  router.post('/batches', handle((req, actor) => service.generate(req.body, actor)));
  router.get('/batches', handle((req, actor) => service.list(actor, { limit: Number(req.query.limit ?? 10) })));
  router.get('/batches/:id', handle((req, actor) => {
    if (req.query.unusedOnly != null && !['true', 'false'].includes(req.query.unusedOnly)) fail(400, 'QT-WEBSITE-FILTER', 'unusedOnly must be true or false.');
    return service.export(req.params.id, actor, { unusedOnly: req.query.unusedOnly !== 'false' });
  }));
  return router;
}
