-- Allow administrators to recover newly issued license keys securely and look
-- licenses up by a raw Device ID without storing that raw Device ID.

ALTER TABLE licenses ADD COLUMN IF NOT EXISTS key_ciphertext TEXT NULL;

CREATE INDEX IF NOT EXISTS idx_devices_device_hash
  ON devices(device_hash);
