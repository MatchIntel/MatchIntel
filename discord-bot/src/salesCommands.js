import { SlashCommandBuilder } from 'discord.js';

const productOption = option => option.setName('product').setDescription('Choose a saved product (type to search)').setAutocomplete(true);
const amountOption = (option, name, description, required = false) => option.setName(name).setDescription(description).setRequired(required).setMinValue(0).setMaxValue(1000000);
export const salesCommands = [
  new SlashCommandBuilder().setName('addproduct').setDescription('Admin: add a product and its default USD price')
    .addStringOption(o => o.setName('name').setDescription('Product name').setRequired(true).setMaxLength(80))
    .addNumberOption(o => amountOption(o, 'price', 'Default price per unit in USD', true))
    .addNumberOption(o => amountOption(o, 'cost', 'Optional cost per unit in USD; defaults to zero')),
  new SlashCommandBuilder().setName('editproduct').setDescription('Admin: change a product, price, cost, or archive status')
    .addStringOption(o => productOption(o).setRequired(true))
    .addStringOption(o => o.setName('name').setDescription('New product name').setMaxLength(80))
    .addNumberOption(o => amountOption(o, 'price', 'New default unit price in USD'))
    .addNumberOption(o => amountOption(o, 'cost', 'New default cost per unit in USD'))
    .addBooleanOption(o => o.setName('active').setDescription('False archives it; true makes it available for new sales')),
  new SlashCommandBuilder().setName('products').setDescription('Staff: list products, prices, and product IDs')
    .addBooleanOption(o => o.setName('archived').setDescription('Also show archived products'))
    .addStringOption(o => o.setName('search').setDescription('Search by product name').setMaxLength(100)),
  new SlashCommandBuilder().setName('confirm').setDescription('Staff: record an already-paid sale; does not charge or issue a key')
    .addStringOption(o => productOption(o).setRequired(true))
    .addNumberOption(o => amountOption(o, 'price', 'Actual price per unit in USD; leave blank to use saved price'))
    .addIntegerOption(o => o.setName('quantity').setDescription('Units sold; defaults to 1').setMinValue(1).setMaxValue(1000))
    .addNumberOption(o => amountOption(o, 'cost', 'Actual cost per unit in USD; leave blank for saved cost'))
    .addNumberOption(o => o.setName('fee').setDescription('Total payment fee for this sale in USD; defaults to zero').setMinValue(0).setMaxValue(1000000000))
    .addUserOption(o => o.setName('customer').setDescription('Optional customer Discord account'))
    .addStringOption(o => o.setName('reference').setDescription('Payment transaction/order reference; prevents duplicate entries').setMaxLength(120))
    .addStringOption(o => o.setName('sold_on').setDescription('Optional past date YYYY-MM-DD; otherwise records now').setMinLength(10).setMaxLength(10))
    .addStringOption(o => o.setName('note').setDescription('Private sale note').setMaxLength(500)),
  new SlashCommandBuilder().setName('dashboard').setDescription('Admin: generate your private sales and recorded-profit dashboard image')
    .addStringOption(o => o.setName('period').setDescription('Reporting window; defaults to 30 days').addChoices(
      { name: 'Last 7 days', value: '7d' }, { name: 'Last 30 days', value: '30d' },
      { name: 'Last 90 days', value: '90d' }, { name: 'All time', value: 'all' }))
    .addStringOption(o => productOption(o)),
  new SlashCommandBuilder().setName('sales').setDescription('Admin: privately view recent sales and IDs for corrections')
    .addIntegerOption(o => o.setName('limit').setDescription('How many entries to show; defaults to 10').setMinValue(1).setMaxValue(20))
    .addBooleanOption(o => o.setName('voided').setDescription('Also show voided entries')),
  new SlashCommandBuilder().setName('voidsale').setDescription('Admin: exclude a mistaken sale from totals while preserving its audit record')
    .addStringOption(o => o.setName('sale_id').setDescription('Full sale ID from /confirm or /sales').setRequired(true).setMaxLength(36))
    .addStringOption(o => o.setName('reason').setDescription('Why this entry should be voided').setRequired(true).setMaxLength(300))
];
export const salesCommandNames = new Set(salesCommands.map(c => c.name));
