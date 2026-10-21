-- Business purchases are separate from per-sale costs and payment fees.
CREATE TABLE qt_sales_expenses (
  id UUID PRIMARY KEY,
  guild_id TEXT NOT NULL,
  description TEXT NOT NULL CHECK (length(description) BETWEEN 1 AND 240),
  category TEXT NOT NULL CHECK (length(category) BETWEEN 1 AND 40),
  amount_cents BIGINT NOT NULL CHECK (amount_cents BETWEEN 1 AND 100000000),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  product_id UUID,
  product_name TEXT,
  payment_reference TEXT,
  interaction_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  spent_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_at TIMESTAMPTZ,
  voided_by TEXT,
  void_reason TEXT,
  FOREIGN KEY (guild_id, product_id) REFERENCES qt_sales_products(guild_id, id),
  UNIQUE (guild_id, interaction_id)
);
CREATE UNIQUE INDEX qt_expenses_reference_unique
  ON qt_sales_expenses(guild_id,lower(payment_reference)) WHERE payment_reference IS NOT NULL AND voided_at IS NULL;
CREATE INDEX qt_expenses_guild_spent ON qt_sales_expenses(guild_id,spent_at DESC) WHERE voided_at IS NULL;
CREATE INDEX qt_expenses_product_spent ON qt_sales_expenses(guild_id,product_id,spent_at DESC) WHERE voided_at IS NULL;
