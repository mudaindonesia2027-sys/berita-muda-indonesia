# MUDA Indonesia V19 — Public Experience 041: Public Intelligence Core

Additive upgrade from 040. No migrations added and no prior application files intentionally removed.

## Public intelligence added
- Reader-local activity inventory: reads, likes, shares, saved, categories, regions, topics.
- Device time/context engine using the browser timezone and clock.
- Optional geolocation with explicit browser permission; location is not persisted as an identity profile.
- Regional map engine using OpenStreetMap/Leaflet when available, with 35 Central Java regency/city nodes and real content counts from `owner_content_regions`.
- Voice welcome and browser voice commands for search, trending, and regional navigation.
- Trending topic engine from available `analytics_events` + published article engagement data, with explicit uncertainty when data is insufficient.
- Browser notifications for newly surfaced top trending topics, using the service worker.
- Factual proof/source board on the public site showing source tables and generated timestamps.
- Public advertising intelligence endpoint based on `owner_ad_pricing_rules`, including effective period, active state, calculated rate and fluctuation versus approved rate.

## Data integrity
The public layer does not invent article body text, reader counts, trend certainty, ad prices, or provider availability. When source data is missing, the interface states that it is unavailable.

## Compatibility
- Uses existing V19 backend and migrations 001–035.
- No new migration is required for this release.
- Map and voice capabilities degrade gracefully when provider/browser support is unavailable.
