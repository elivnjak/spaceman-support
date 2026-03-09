#!/usr/bin/env bash
set -u -o pipefail

BASE_URL="${BASE_URL:-http://127.0.0.1:3001}"
TURN_TIMEOUT_MS="${PLAYBOOK_TEST_TURN_TIMEOUT_MS:-60000}"
SCENARIO_RETRY_ATTEMPTS="${PLAYBOOK_TEST_SCENARIO_RETRY_ATTEMPTS:-3}"
SCENARIO_RETRY_DELAY_MS="${PLAYBOOK_TEST_SCENARIO_RETRY_DELAY_MS:-12000}"
SLEEP_SECONDS="${PLAYBOOK_TEST_BATCH_SLEEP_SECONDS:-5}"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --base-url)
      BASE_URL="$2"
      shift 2
      ;;
    --timeout-ms)
      TURN_TIMEOUT_MS="$2"
      shift 2
      ;;
    --sleep-seconds)
      SLEEP_SECONDS="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

shopt -s nullglob

FAMILY_PATTERNS=(
  "generated-cause-resolution-fb-draw-handle-stuck-3d1f5a5d-*"
  "generated-cause-resolution-fb-freeze-up-thermal-overload-trip-ad384457-*"
  "generated-cause-resolution-fb-inconsistent-texture-between-sides-742b5610-*"
  "generated-cause-resolution-fb-low-mix-light-with-full-hopper-418faed3-*"
  "generated-cause-resolution-fb-machine-not-cooling-cb867448-*"
  "generated-cause-resolution-fb-product-freeze-up-thick-83edffc5-*"
  "generated-cause-resolution-fb-product-leaking-from-door-045a07aa-*"
  "generated-cause-resolution-fb-product-leaking-inside-machine-e181c5d8-*"
  "generated-cause-resolution-fb-product-not-freezing-3724e28d-*"
  "generated-cause-resolution-ss-beater-not-turning-210ce883-*"
  "generated-cause-resolution-ss-excessive-internal-leak-drip-tray-ffb3f31d-*"
  "generated-cause-resolution-ss-excessive-overrun-foamy-d1b2410b-*"
  "generated-cause-resolution-ss-first-pull-runny-after-idle-85ffe006-*"
  "generated-cause-resolution-ss-hopper-too-warm-or-too-cold-9ff84b9b-*"
  "generated-cause-resolution-ss-insufficient-overrun-flat-2cda6bd9-*"
  "generated-cause-resolution-ss-leak-from-door-or-spout-6e69e160-*"
  "generated-cause-resolution-ss-machine-freeze-up-stop1-stop2-79b6e644-*"
  "generated-cause-resolution-ss-machine-not-cooling-d045299a-*"
  "generated-cause-resolution-ss-no-power-or-trips-breaker-008caa85-*"
  "generated-cause-resolution-ss-off-taste-contamination-bf6d83d4-*"
  "generated-cause-resolution-ss-product-too-icy-7a48d039-*"
  "generated-cause-resolution-ss-product-too-soft-runny-61626282-*"
  "generated-cause-resolution-ss-product-too-stiff-freeze-up-risk-761ad8a1-*"
  "generated-cause-resolution-ss-stop4-temperature-sensor-error-312c4504-*"
  "generated-cause-resolution-too-runny-3080dfb7-*"
)

declare -a SCENARIOS=()
scenario_seen() {
  local needle="$1"
  local existing
  if [[ ${#SCENARIOS[@]} -eq 0 ]]; then
    return 1
  fi
  for existing in "${SCENARIOS[@]}"; do
    if [[ "$existing" == "$needle" ]]; then
      return 0
    fi
  done
  return 1
}

for pattern in "${FAMILY_PATTERNS[@]}"; do
  matches=(data/playbook_tests/$pattern)
  for match in "${matches[@]}"; do
    scenario="$(basename "$match")"
    if ! scenario_seen "$scenario"; then
      SCENARIOS+=("$scenario")
    fi
  done
done

if [[ ${#SCENARIOS[@]} -eq 0 ]]; then
  echo "No matching remaining cause-resolution scenarios found."
  exit 0
fi

IFS=$'\n' SCENARIOS=($(printf '%s\n' "${SCENARIOS[@]}" | sort))
unset IFS

timestamp="$(date +%Y-%m-%dT%H-%M-%S)"
batch_dir="logs/playbook-tests/batch-remaining-cause-resolution-${timestamp}"
mkdir -p "$batch_dir"
batch_log="$batch_dir/run.log"
summary_file="$batch_dir/summary.txt"

declare -a FAILURES=()
declare -a PASSES=()

echo "Base URL: $BASE_URL" | tee "$batch_log"
echo "Turn timeout: ${TURN_TIMEOUT_MS}ms" | tee -a "$batch_log"
echo "Retry attempts: ${SCENARIO_RETRY_ATTEMPTS}" | tee -a "$batch_log"
echo "Retry delay: ${SCENARIO_RETRY_DELAY_MS}ms" | tee -a "$batch_log"
echo "Sleep between runs: ${SLEEP_SECONDS}s" | tee -a "$batch_log"
echo "Scenario count: ${#SCENARIOS[@]}" | tee -a "$batch_log"
echo | tee -a "$batch_log"

run_index=0
for scenario in "${SCENARIOS[@]}"; do
  run_index=$((run_index + 1))
  echo "[$run_index/${#SCENARIOS[@]}] Running $scenario" | tee -a "$batch_log"

  output=""
  if ! output="$(
    PLAYBOOK_TEST_TURN_TIMEOUT_MS="$TURN_TIMEOUT_MS" \
    PLAYBOOK_TEST_SCENARIO_RETRY_ATTEMPTS="$SCENARIO_RETRY_ATTEMPTS" \
    PLAYBOOK_TEST_SCENARIO_RETRY_DELAY_MS="$SCENARIO_RETRY_DELAY_MS" \
    npm run playbook:test -- --scenario "$scenario" --base-url "$BASE_URL" 2>&1
  )"; then
    printf '%s\n' "$output" | tee -a "$batch_log" >/dev/null
    FAILURES+=("$scenario|command_failed|")
    echo | tee -a "$batch_log"
    sleep "$SLEEP_SECONDS"
    continue
  fi

  printf '%s\n' "$output" | tee -a "$batch_log" >/dev/null

  report_dir="$(printf '%s\n' "$output" | sed -n 's/^Playbook tests complete\..* Report: \(.*\)$/\1/p' | tail -n 1)"
  if [[ -z "$report_dir" ]]; then
    FAILURES+=("$scenario|missing_report|")
    echo | tee -a "$batch_log"
    sleep "$SLEEP_SECONDS"
    continue
  fi

  summary_md="$report_dir/summary.md"
  if [[ ! -f "$summary_md" ]]; then
    FAILURES+=("$scenario|missing_summary|$report_dir")
    echo | tee -a "$batch_log"
    sleep "$SLEEP_SECONDS"
    continue
  fi

  failed_count="$(sed -n 's/^- Failed: \([0-9][0-9]*\)$/\1/p' "$summary_md" | tail -n 1)"
  if [[ -z "$failed_count" ]]; then
    FAILURES+=("$scenario|unparsed_summary|$report_dir")
  elif [[ "$failed_count" -gt 0 ]]; then
    FAILURES+=("$scenario|scenario_failed|$report_dir")
  else
    PASSES+=("$scenario|$report_dir")
  fi

  echo | tee -a "$batch_log"
  sleep "$SLEEP_SECONDS"
done

{
  echo "Remaining cause-resolution batch summary"
  echo "Base URL: $BASE_URL"
  echo "Turn timeout: ${TURN_TIMEOUT_MS}ms"
  echo "Scenarios run: ${#SCENARIOS[@]}"
  echo "Passed: ${#PASSES[@]}"
  echo "Failed: ${#FAILURES[@]}"
  echo

  if [[ ${#FAILURES[@]} -eq 0 ]]; then
    echo "No failures."
  else
    echo "Failures:"
    for item in "${FAILURES[@]}"; do
      scenario="${item%%|*}"
      rest="${item#*|}"
      reason="${rest%%|*}"
      report="${item##*|}"
      echo "- $scenario"
      echo "  reason: $reason"
      if [[ -n "$report" ]]; then
        echo "  report: $report"
      fi
    done
  fi
} | tee "$summary_file"

echo
echo "Batch log: $batch_log"
echo "Batch summary: $summary_file"

if [[ ${#FAILURES[@]} -gt 0 ]]; then
  exit 1
fi
