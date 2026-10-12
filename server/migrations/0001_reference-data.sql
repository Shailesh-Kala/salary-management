-- Up Migration
CREATE TABLE hr_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE CHECK (email = lower(email)),
  name text NOT NULL,
  password_hash text NOT NULL,
  token_version int NOT NULL DEFAULT 1,
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE exchange_rates (
  currency_code char(3) PRIMARY KEY,
  inr_per_unit numeric(18, 6) NOT NULL CHECK (inr_per_unit > 0),
  as_of date NOT NULL,
  updated_by uuid REFERENCES hr_users (id),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (currency_code <> 'INR' OR inr_per_unit = 1)
);

CREATE TABLE countries (
  code char(2) PRIMARY KEY,
  name text NOT NULL UNIQUE,
  currency_code char(3) NOT NULL REFERENCES exchange_rates (currency_code)
);

CREATE TABLE exchange_rate_changes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  currency_code char(3) NOT NULL REFERENCES exchange_rates (currency_code),
  old_inr_per_unit numeric(18, 6) NOT NULL,
  new_inr_per_unit numeric(18, 6) NOT NULL,
  old_as_of date NOT NULL,
  new_as_of date NOT NULL,
  changed_by uuid NOT NULL REFERENCES hr_users (id),
  changed_at timestamptz NOT NULL DEFAULT now()
);

-- Supported countries and the fixed rate snapshot (illustrative, not live rates).
-- Resets rates to the snapshot, so it is only called by this migration, the seed and tests.
CREATE FUNCTION load_reference_data() RETURNS void LANGUAGE sql AS $$
  INSERT INTO exchange_rates (currency_code, inr_per_unit, as_of) VALUES
    ('INR', 1, '2026-10-01'),
    ('USD', 88.75, '2026-10-01'),
    ('GBP', 118.40, '2026-10-01'),
    ('EUR', 103.20, '2026-10-01'),
    ('SGD', 68.90, '2026-10-01'),
    ('AUD', 58.30, '2026-10-01'),
    ('CAD', 63.60, '2026-10-01')
  ON CONFLICT (currency_code) DO UPDATE
    SET inr_per_unit = EXCLUDED.inr_per_unit, as_of = EXCLUDED.as_of,
        updated_by = NULL, updated_at = now();

  INSERT INTO countries (code, name, currency_code) VALUES
    ('IN', 'India', 'INR'),
    ('US', 'United States', 'USD'),
    ('GB', 'United Kingdom', 'GBP'),
    ('DE', 'Germany', 'EUR'),
    ('FR', 'France', 'EUR'),
    ('SG', 'Singapore', 'SGD'),
    ('AU', 'Australia', 'AUD'),
    ('CA', 'Canada', 'CAD')
  ON CONFLICT (code) DO NOTHING;
$$;

SELECT load_reference_data();

-- Down Migration
DROP FUNCTION load_reference_data();
DROP TABLE exchange_rate_changes;
DROP TABLE countries;
DROP TABLE exchange_rates;
DROP TABLE hr_users;
