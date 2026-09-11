# Unified Owner Action Matrix

V10.2 uses a database-backed action registry as the source of truth for Owner command permissions.

Each action has:
- `action_key`
- `display_name`
- `category`
- `risk_level`
- `requires_confirmation`
- `enabled`
- `capabilities`
- `min_role`

Role levels:
- `admin` — diagnostics/read-oriented operations
- `owner` — operational newsroom/business controls
- `super_admin` — critical security, payout, and emergency controls

Execution path:
`Owner command -> action registry -> role gate -> confirmation gate -> executor -> audit log -> command result`

The executor is deterministic and auditable. It does not claim to provide arbitrary natural-language autonomy without an adapter.
