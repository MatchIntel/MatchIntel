-- Manual sales records are separate from license issuance and payment processing.
CREATE TABLE qt_sales_products (
  id UUID PRIMARY KEY,
  guild_id TEXT NOT NULL,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  name_key TEXT NOT NULL,
  price_cents BIGINT NOT NULL CHECK (price_cents BETWEEN 0 AND 100000000),
  cost_cents BIGINT NOT NULL DEFAULT 0 CHECK (cost_cents BETWEEN 0 AND 100000000),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (guild_id, name_key),
  UNIQUE (guild_id, id)
);
CREATE TABLE qt_sales (
  id UUID PRIMARY KEY,
  guild_id TEXT NOT NULL,
  product_id UUID NOT NULL,
  product_name TEXT NOT NULL,
  unit_price_cents BIGINT NOT NULL CHECK (unit_price_cents BETWEEN 0 AND 100000000),
  unit_cost_cents BIGINT NOT NULL CHECK (unit_cost_cents BETWEEN 0 AND 100000000),
  quantity INTEGER NOT NULL CHECK (quantity BETWEEN 1 AND 1000),
  fee_cents BIGINT NOT NULL CHECK (fee_cents BETWEEN 0 AND 100000000000),
  currency TEXT NOT NULL DEFAULT 'USD' CHECK (currency = 'USD'),
  customer_id TEXT,
  payment_reference TEXT,
  note TEXT NOT NULL DEFAULT '',
  interaction_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  recorded_by TEXT NOT NULL,
  sold_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  voided_at TIMESTAMPTZ,
  voided_by TEXT,
  void_reason TEXT,
  FOREIGN KEY (guild_id, product_id) REFERENCES qt_sales_products(guild_id, id),
  UNIQUE (guild_id, interaction_id)
);
CREATE UNIQUE INDEX qt_sales_payment_reference_unique
  ON qt_sales (guild_id, lower(payment_reference)) WHERE payment_reference IS NOT NULL AND voided_at IS NULL;
CREATE INDEX qt_sales_guild_sold ON qt_sales(guild_id, sold_at DESC) WHERE voided_at IS NULL;
CREATE INDEX qt_sales_product_sold ON qt_sales(guild_id, product_id, sold_at DESC) WHERE voided_at IS NULL;
