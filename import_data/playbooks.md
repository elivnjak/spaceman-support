# Spaceman Support Playbooks (Spreadsheet Pack)

Generated: 2026-02-20

This folder contains 30 issue playbooks (one XLSX per issue), plus two shared CSV dictionaries.

## Files
- `*.xlsx` — One playbook per issue slug (based on the provided template).
- `label_dictionary.csv` — Maps label IDs to human-readable names and descriptions.
- `action_catalog.csv` — Supported action IDs referenced by Evidence rows. It also stores canonical `expected_input_*` metadata used to keep chat request controls consistent (`enum`, `boolean`, `number`, `photo`, `text`) plus safety level.

## Spreadsheet conventions
- **Evidence**: each row captures one atomic signal (photo, observation, confirmation, reading, timing).
- **Causes**: each cause references one or more Evidence IDs in `ruling_evidence` (comma-separated).
- **Steps**: safe, operator-friendly actions only; anything involving refrigeration/electrics is “technician”.

## Source library
Primary references used during creation (Spaceman Service KB).

- Spaceman Soft Serve Best Practices: https://smservice.spacemanusa.com/portal/en/kb/articles/sog-ss-bestpractices
- Spaceman Soft Serve Product Mix Guide: https://smservice.spacemanusa.com/portal/en/kb/articles/sog-ss-productmixguide
- Spaceman Soft Serve Brix Level: https://smservice.spacemanusa.com/portal/en/kb/articles/sog-ss-brix
- Spaceman Soft Serve Common Errors: https://smservice.spacemanusa.com/portal/en/kb/articles/sog-commonerrors
- Soft Serve: Troubleshooting STOP 1: https://smservice.spacemanusa.com/portal/en/kb/articles/ss-troubleshooting-stop1
- Soft Serve: Troubleshooting STOP 2: https://smservice.spacemanusa.com/portal/en/kb/articles/ss-troubleshooting-stop2
- Soft Serve: Troubleshooting STOP 4: https://smservice.spacemanusa.com/portal/en/kb/articles/ss-troubleshooting-stop4
- Soft Serve: Troubleshooting Leaking From Door: https://smservice.spacemanusa.com/portal/en/kb/articles/ss-troubleshooting-leakingfromdoor
- Spaceman Frozen Beverage Best Practices: https://smservice.spacemanusa.com/portal/en/kb/articles/sog-fb-bestpractices
- Spaceman Frozen Beverage Product Mix Guide: https://smservice.spacemanusa.com/portal/en/kb/articles/sog-fb-productmixguide
- Spaceman Frozen Beverage Brix Level: https://smservice.spacemanusa.com/portal/en/kb/articles/sog-fb-brix
- Frozen Beverage: Troubleshooting Frost Check: https://smservice.spacemanusa.com/portal/en/kb/articles/fb-troubleshooting-frost-check
- Frozen Beverage: Product Leaking Inside Machine: https://smservice.spacemanusa.com/portal/en/kb/articles/tsg-fb-troubleshooting-productleakinginside
- Frozen Beverage: Product Leaking From Door: https://smservice.spacemanusa.com/portal/en/kb/articles/tsg-fb-troubleshooting-productleakingfromdoor
- Frozen Beverage: Troubleshooting Machine Not Cooling: https://smservice.spacemanusa.com/portal/en/kb/articles/fb-troubleshooting-machinenotcooling

## Sources appendix by issue

### `ss_product_too_soft_runny` — Soft serve too soft / runny

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Over-pulling / insufficient recovery time | Spaceman blog on consistency issues (runny from over-pulling) + summer readiness tips | high |
| `` | Restricted airflow / clearance issues | Spaceman blog notes minimum clearance/air circulation; Spaceman SS not cooling guide mentions condenser blockage | high |
| `` | Hot-gas release causing runny first dispense | Spaceman Hot Gas Release doc + consistency/idle notes | high |
| `` | Air tube clogged/incorrect cleaning | Spaceman consistency issues blog + daily tasks guide | high |

### `ss_product_too_icy` — Soft serve icy / too hard

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `cause_low_brix` | Brix too low leading to icy texture | Spaceman Soft Serve Brix Level; Spaceman Soft Serve Product Mix Guide; Spaceman Soft Serve Common Errors | high |
| `cause_not_aged_or_warm_mix` | Mix not aged/chilled properly or hopper temperature issues | Spaceman Soft Serve Best Practices; Spaceman Soft Serve Product Mix Guide | medium |
| `cause_setting_too_cold` | Settings too cold/high viscosity target | Spaceman SS: Adjusting Settings; Spaceman Soft Serve Best Practices | low |

### `ss_product_too_stiff_freeze_up_risk` — Soft serve too stiff (starved cylinder / freeze-up risk)

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Low mix/starvation leads to stiff product/freeze-up | Spaceman consistency issues blog (low mix starves cylinder and can freeze up) + daily tasks guide warning | high |
| `` | Air tube/pump blockage leads to stiffness/freeze-ups | Spaceman consistency issues blog + daily tasks guide | high |
| `` | Viscosity setting mismatch after product change | Spaceman consistency issues blog notes viscosity setting issues after product change | medium |

### `ss_insufficient_overrun_flat` — Soft serve not fluffy (insufficient overrun)

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Air tube orientation/clogging causes insufficient overrun | Spaceman troubleshooting common issues article (air tube hole facing down) + consistency issues blog | high |
| `` | High pull rate without recovery affects consistency/overrun | Spaceman consistency issues blog + summer readiness tips | medium |

### `ss_excessive_overrun_foamy` — Soft serve too airy/foamy (excess overrun)

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Low mix can cause air ingestion/sputtering and starve cylinder | Spaceman consistency issues blog (low mix/starvation) + troubleshooting common issues article | medium |

### `ss_first_pull_runny_after_idle` — First dispense runny after idle (hot-gas release / idle effects)

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Hot-gas release can make first dispense runny; often recommended OFF unless advised | Spaceman Hot Gas Release document | high |
| `` | Product sitting in cylinder can change texture; pulling refresh improves | Spaceman consistency issues blog describes refreshing after sitting (icy/soft) | medium |

### `ss_machine_freeze_up_stop1_stop2` — Machine freeze-up (STOP 1 / STOP 2)

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Air tubes clogging can starve cylinder leading to STOP 1/2 freeze-up | Spaceman daily tasks guide warning + Spaceman troubleshooting common issues article on freeze-up | high |
| `` | Low mix can starve cylinder and cause freeze-up | Spaceman consistency issues blog + troubleshooting common issues article | high |

### `ss_machine_not_cooling` — Machine not cooling / won’t freeze product

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `cause_airflow` | Airflow restriction/dirty condenser | Spaceman Soft Serve Best Practices (condenser cleaning, airflow clearance); Spaceman Soft Serve Common Errors | high |
| `cause_water_cooled` | Water-cooled condenser/water regulating valve issue (if water-cooled model) | Spaceman Water Cooled Units | medium |
| `cause_refrigeration` | Refrigeration fault (call technician) | Spaceman Soft Serve Best Practices (when to call for service) | low |

### `ss_stop4_temperature_sensor_error` — STOP 4 temperature sensor error

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | STOP 4 relates to temperature sensor error in Spaceman guides | Spaceman SS Troubleshooting STOP4 article | high |

### `ss_hopper_too_warm_or_too_cold` — Hopper temperature too warm/too cold

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Machines aren’t designed to refrigerate hot liquids; use pre-chilled mix; avoid frozen chunks | Spaceman troubleshooting common issues article (hopper warm/cold; pre-chill; no frozen chunks) | high |

### `ss_beater_not_turning` — Beater/motor not turning (no agitation)

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Motor/overload diagnostics are technician scope; Spaceman guides cover 1-phase motor and overload resets | Spaceman SS 1-Phase Motor troubleshooting guide (technician) | medium |

### `ss_leak_from_door_or_spout` — Leak from dispensing door/spout

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Improper lubrication/assembly and worn wearable parts cause leaking; replace wearable parts regularly | Spaceman troubleshooting common issues article (leaks, lubrication, wearable parts) + Maintenance kits/wear parts guidance | high |

### `ss_excessive_internal_leak_drip_tray` — Excessive leak into drip tray / under machine

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Wear parts and lubrication directly affect leaks; replace wearable parts on schedule | Spaceman troubleshooting common issues article (leaks; lubrication; wearable parts) + Maintenance kit guidance | high |

### `ss_off_taste_contamination` — Off taste / suspected contamination

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Cleaning frequency and sanitation critical; Spaceman recommends regular cleaning and mid-day cleaning of parts | Spaceman machine operation daily tasks guide + best practice/maintenance guidance | high |

### `ss_no_power_or_trips_breaker` — No power / trips breaker or RCD

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Internal motor/overload systems exist; electrical diagnosis is technician-only | Spaceman SS 1-Phase Motor troubleshooting guide (describes overload/capacitor components) | medium |

### `fb_product_not_freezing` — Frozen beverage not freezing (soupy)

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Proper brix range and effects of too little/too much sugar | Spaceman Frozen Beverage Product Mix Guide (13–18 brix; sugar effects) | high |
| `` | Condenser/airflow restriction degrades performance | Spaceman FB troubleshooting not cooling + SS/FB condenser guidance | high |
| `` | Pre-chill product; never add frozen chunks | Spaceman FB best practices + product mix guide | high |

### `fb_product_freeze_up_thick` — Frozen beverage over-freezing / too thick

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `cause_brix_low` | Brix too low (too much water) leading to freeze-up risk | Spaceman Frozen Beverage Brix Level; Spaceman Frozen Beverage Product Mix Guide | high |
| `cause_brix_high_viscous` | Brix too high/too viscous leading to thick product and strain | Spaceman Frozen Beverage Brix Level; Spaceman Frozen Beverage Product Mix Guide | medium |
| `cause_setting_too_cold` | Freeze/consistency settings too aggressive (needs support/tech) | Spaceman SS: Adjusting Settings (how settings work; mix temperature guidance); Spaceman Frozen Beverage Best Practices (when to contact support) | low |

### `fb_freeze_up_thermal_overload_trip` — Freeze-up causes motor/thermal overload trip

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Manual machine reset/overload related guidance exists; freeze-ups drive overload trips | Spaceman FB Manual Machine Reset + product mix guide (freeze-up risk) | medium |

### `fb_low_mix_light_with_full_hopper` — Low-mix light with hopper full (sensor false trip)

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `cause_sensor_fault` | Low mix sensor failure/contamination/misalignment | Spaceman Frozen Beverage Best Practices (mix handling, cleanliness, sensor-related operational checks); Spaceman Frozen Beverage Product Mix Guide (proper prep/priming); Spaceman Frozen Beverage Brix Level (recipe correctness) | medium |
| `cause_air_lock_or_no_prime` | Air lock / line not primed / empty mix bag even though hopper looks full | Spaceman Frozen Beverage Best Practices; Spaceman Frozen Beverage Product Mix Guide | medium |
| `cause_wiring_fault` | Intermittent wiring/connection issue (technician) | Spaceman Frozen Beverage Best Practices (when to call technician)  | low |

### `fb_product_leaking_from_door` — Product leaking from door / draw valve

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Door leaks commonly due to cleaning/orientation, lubrication and worn seals | Spaceman FB Troubleshooting Product Leaking From Door article | high |

### `fb_product_leaking_inside_machine` — Product leaking inside machine / internal drip tray

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Internal leaking commonly due to improper cleaning/lube or worn tune-up parts; shaft wear may need service | Spaceman FB Product Leaking Inside Machine article | high |

### `fb_machine_not_cooling` — Machine not cooling (FB)

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `cause_airflow_clearance` | Airflow restricted or insufficient clearance | Spaceman Frozen Beverage Best Practices (keep condenser clean, provide clearance); Spaceman Frozen Beverage Frost Check | high |
| `cause_water_cooled_valve` | Water-cooled condenser/regulating valve misadjusted or water supply issue (if water-cooled model) | Spaceman Water Cooled Units (installation/adjustment guidance) | medium |
| `cause_high_ambient_or_clearance` | High ambient temperature or placement next to heat source | Spaceman Frozen Beverage Best Practices | medium |

### `fb_compressor_runs_no_frost` — Compressor runs but cylinder not frosting (possible refrigeration issue)

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Spaceman frost check is used to diagnose refrigeration functionality and has safety warnings | Spaceman FB Troubleshooting Frost Check article | high |

### `fb_auger_not_turning` — Auger/motor not turning (no agitation)

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Spaceman recommends functionality checks for motors/controls; motor amp-draw and diagnostics are technician procedures | Spaceman Frozen Beverage Functionality Check - Technician | medium |

### `fb_inconsistent_texture_between_sides` — Inconsistent texture between sides/bowls

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Low mix sensors can stop freezing after delay; can false trigger | Spaceman FB low mix sensor article | medium |
| `` | Recipe/brix out of range affects freezing behaviour | Spaceman FB product mix guide | high |

### `fb_brix_out_of_range` — Mix brix out of range / recipe issue

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Spaceman specifies brix range and warns against mixing in machine; sugar extremes impact freezing | Spaceman FB product mix guide | high |

### `fb_chunks_or_particles_in_product` — Chunks/particles in product (clogging / performance issues)

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Spaceman advises: never add frozen product/chunks; pre-chill and pre-mix | Spaceman FB best practices + Spaceman troubleshooting common issues article | high |
| `` | Auto-fill requires thin product with no particulates | Spaceman Auto-Fill System guide | high |

### `fb_draw_handle_stuck` — Draw handle stuck / hard to pull

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `` | Product mix/brix impacts freezing; low brix can cause freeze-ups leading to handling issues | Spaceman FB product mix guide | medium |
| `` | Door/valve leaks and issues often relate to lubrication and seals | Spaceman FB leaking from door guide | medium |

### `fb_display_alarm_or_error` — Display alarm/error (unknown)

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `cause_low_mix_or_door` | Operational interlock such as low mix, lid/door not seated, etc. | Spaceman Frozen Beverage Best Practices; Spaceman Frozen Beverage Frost Check (observational troubleshooting patterns) | medium |
| `cause_sensor_fault` | Sensor or switch fault | Spaceman Frozen Beverage Best Practices | low |
| `cause_power_fluctuation` | Power fluctuation/reset causing alarms | Spaceman Frozen Beverage Best Practices | low |

### `fb_auto_fill_not_refilling` — Auto-fill not refilling (if installed)

| cause_id | cause summary | sources | confidence |
|---|---|---|---|
| `cause_empty_supply_or_valve_closed` | Supply container empty / valve closed / kinked line | Spaceman Frozen Beverage Best Practices (avoid running low, operational checks); Spaceman Frozen Beverage Product Mix Guide (prep and feed) | medium |
| `cause_filter_or_check_valve_blocked` | Filter/check valve blocked | Spaceman Frozen Beverage Best Practices (maintenance/cleanliness); Spaceman Frozen Beverage Product Mix Guide | medium |
| `cause_air_leak_in_line` | Air leak in suction line | Spaceman Frozen Beverage Best Practices | low |
