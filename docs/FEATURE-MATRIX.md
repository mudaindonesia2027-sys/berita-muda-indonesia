# MUDA INDONESIA V10.1 — FEATURE MATRIX

| Area | Capability | Status | Notes |
|---|---|---|---|
| Command | Owner Command Router | ENHANCED | Deterministic intent + action registry |
| Command | Confirmation gate | ACTIVE | High-risk actions require confirmation |
| Command | Command history | ACTIVE | Stored in `owner_commands` |
| Editorial | Article CRUD/edit/publish/archive | ACTIVE | Existing production routes + V10 dashboard |
| Editorial | Video CRUD/edit/publish | ACTIVE | Existing production routes + V10 dashboard |
| Editorial | Revision history | ACTIVE | `content_revisions` |
| Homepage | Composer | ACTIVE | Layout draft/publish/archive |
| Homepage | Public live layout API | ACTIVE | `/api/public/homepage/live` |
| Intelligence | Event clustering | ACTIVE | Existing `news_events` engine |
| Intelligence | Trending rebuild | ACTIVE | Existing `trending_content` engine |
| Intelligence | Owner score | ACTIVE | Decision-support score |
| Intelligence | Personalized recommendation | FOUNDATION | Provider/model-independent foundation |
| AI | AI editorial assistant | PROVIDER DEPENDENT | No fake activation |
| Breaking | Candidate/pipeline control | ACTIVE | Existing breaking engine |
| Audience | Community moderation | ACTIVE | Moderation + reputation |
| Audience | Newsletter operations | ACTIVE | Existing admin routes |
| Money | Revenue intelligence | ACTIVE | Existing revenue routes |
| Money | Internal wallet | FOUNDATION/ACTIVE | Depends on wallet tables existing |
| Money | Wallet summary | ACTIVE | Owner dashboard endpoint |
| Money | Payout operations | ACTIVE/FOUNDATION | Internal bookkeeping/control plane |
| Money | Reconciliation | ACTIVE | Expected vs actual variance record |
| Ads | Campaign controls | ACTIVE/FOUNDATION | Existing database + routes |
| Affiliate | Offer controls | ACTIVE | Existing admin routes |
| Reliability | RSS source health | ACTIVE | Existing sync health/circuit breaker |
| Reliability | Scheduler registry | ACTIVE | Configuration/control plane; worker remains deployment-dependent |
| Automation | Automation run log | ACTIVE | `automation_runs` |
| Governance | Audit trail | ACTIVE | `audit_logs` |
| Governance | Provider registry | ACTIVE | Honest state machine |
| Google | OAuth | PROVIDER DEPENDENT | Requires real OAuth production setup |
| AdSense | Revenue import | PROVIDER DEPENDENT | Requires AdSense account + credentials |
| Social | Auto-publish | PROVIDER DEPENDENT | Requires approved provider integration |
| Payment | Payment gateway | PROVIDER DEPENDENT | Requires merchant/provider configuration |
| Worker | Real cron execution | PROVIDER DEPENDENT | Schedule table is control-plane only |
