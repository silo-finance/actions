#!/usr/bin/env python3
# Example:
# python3 scripts/pull_borrowers/legacy_market_removal.py check --chain sonic --silo-address 0x...
# python3 scripts/pull_borrowers/legacy_market_removal.py prune --chain sonic --silo-address 0x...

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any

SUPPORTED_CHAINS = frozenset({"ethereum", "arbitrum", "avalanche", "sonic"})


def normalize_address(value: str | None) -> str | None:
  if not value:
    return None
  trimmed = value.strip().lower()
  if len(trimmed) == 42 and trimmed.startswith("0x"):
    return trimmed
  return None


def load_snapshot(chain: str) -> list[dict[str, Any]]:
  snapshot_path = (
    Path(__file__).resolve().parents[2] / "src" / "data" / "liquidation" / "silos" / f"{chain}.json"
  )
  payload = json.loads(snapshot_path.read_text(encoding="utf-8"))
  silos = payload.get("silos")
  if not isinstance(silos, list):
    raise ValueError(f"Invalid snapshot format in {snapshot_path}")
  return [row for row in silos if isinstance(row, dict)]


def evaluate_removal(chain: str, silo_address: str) -> tuple[bool, str]:
  silos = load_snapshot(chain)
  primary_rows = [
    row for row in silos if normalize_address(str(row.get("siloAddress") or "")) == silo_address
  ]

  if not primary_rows:
    for row in silos:
      other = row.get("otherSilo")
      if not isinstance(other, dict):
        continue
      other_address = normalize_address(str(other.get("siloAddress") or ""))
      if other_address == silo_address:
        return False, "other_silo_only"
    return False, "not_in_snapshot"

  if len(primary_rows) > 1:
    raise ValueError(f"Duplicate primary snapshot rows for {chain}:{silo_address}")

  market_version = primary_rows[0].get("marketVersion")
  if market_version != "legacy":
    return False, "not_legacy"

  if chain not in SUPPORTED_CHAINS:
    return False, "chain_without_positions_feed"

  return True, "legacy_primary"


def write_github_output(key: str, value: str) -> None:
  output_path = os.environ.get("GITHUB_OUTPUT", "").strip()
  if not output_path:
    return
  with open(output_path, "a", encoding="utf-8") as handle:
    handle.write(f"{key}={value}\n")


def run_check(chain: str, silo_address: str) -> None:
  should_prune, reason = evaluate_removal(chain, silo_address)
  print(f"[legacy-market-removal] check chain={chain} silo={silo_address} should_prune={should_prune} reason={reason}")
  write_github_output("should_prune_legacy", "true" if should_prune else "false")
  write_github_output("prune_reason", reason)


def prune_json_file(path: Path, market_id: str) -> int:
  if not path.exists():
    print(f"[legacy-market-removal] skip missing file: {path}")
    return 0

  payload = json.loads(path.read_text(encoding="utf-8"))
  if not isinstance(payload, list):
    raise ValueError(f"Expected JSON array in {path}")

  kept: list[Any] = []
  removed = 0
  for row in payload:
    if not isinstance(row, dict):
      kept.append(row)
      continue
    debt_market_id = normalize_address(str(row.get("debt_market_id") or ""))
    silo_address = normalize_address(str(row.get("silo_address") or ""))
    if debt_market_id == market_id or silo_address == market_id:
      removed += 1
      continue
    kept.append(row)

  path.write_text(json.dumps(kept, indent=2) + "\n", encoding="utf-8")
  print(f"[legacy-market-removal] pruned {removed} rows from {path} (kept {len(kept)})")
  return removed


def run_prune(chain: str, silo_address: str) -> None:
  # Snapshot may already be removed in CI; pruning is gated by the prior `check` step.
  base_dir = Path(__file__).resolve().parent
  borrowers_path = base_dir / f"{chain}_borrowers.json"
  positions_path = base_dir / f"{chain}_positions.json"
  removed_borrowers = prune_json_file(borrowers_path, silo_address)
  removed_positions = prune_json_file(positions_path, silo_address)
  print(
    f"[legacy-market-removal] done chain={chain} market={silo_address} "
    f"removed_borrowers={removed_borrowers} removed_positions={removed_positions}"
  )


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(description="Check/prune legacy market JSON data on silo removal.")
  subparsers = parser.add_subparsers(dest="command", required=True)

  for command in ("check", "prune"):
    cmd = subparsers.add_parser(command)
    cmd.add_argument("--chain", required=True, help="Chain key (e.g. sonic).")
    cmd.add_argument("--silo-address", required=True, help="Primary silo market address (0x...).")

  return parser.parse_args()


def main() -> None:
  args = parse_args()
  chain = args.chain.strip().lower()
  silo_address = normalize_address(args.silo_address)
  if not silo_address:
    raise ValueError("Invalid --silo-address.")

  if args.command == "check":
    run_check(chain, silo_address)
    return
  if args.command == "prune":
    run_prune(chain, silo_address)
    return

  raise ValueError(f"Unsupported command: {args.command}")


if __name__ == "__main__":
  main()
