import { SlashCommandBuilder } from 'discord.js';

export const WEBSITE_KEY_COMMAND_NAMES = ['genwebsitekeys', 'websitebatches', 'exportwebsitekeys'];
export const websiteKeyCommands = [
  new SlashCommandBuilder().setName('genwebsitekeys').setDescription('Admin: generate unlinked one-PC keys and download a website-stock TXT')
    .addIntegerOption(o => o.setName('count').setDescription('How many keys to generate (1–1000)').setRequired(true).setMinValue(1).setMaxValue(1000))
    .addStringOption(o => o.setName('plan').setDescription('Lifetime or timed access starting on first activation').setRequired(true).addChoices({ name: 'Lifetime', value: 'lifetime' }, { name: 'Timed (1–30 days)', value: 'trial' }))
    .addIntegerOption(o => o.setName('trial_days').setDescription('Duration for timed keys; default 3 days, ignored for lifetime').setMinValue(1).setMaxValue(30))
    .addStringOption(o => o.setName('note').setDescription('Private batch label, e.g. SellAuth lifetime stock').setMaxLength(500)),
  new SlashCommandBuilder().setName('websitebatches').setDescription('Admin: list website-key batches and unused-key counts')
    .addIntegerOption(o => o.setName('limit').setDescription('Batches to show; default 10').setMinValue(1).setMaxValue(20)),
  new SlashCommandBuilder().setName('exportwebsitekeys').setDescription('Admin: recover a website-key batch as a TXT without generating more keys')
    .addStringOption(o => o.setName('batch_id').setDescription('Batch ID from /websitebatches').setRequired(true).setMaxLength(36))
    .addBooleanOption(o => o.setName('unused_only').setDescription('Default true; false also includes used/revoked/linked keys for recovery'))
];
