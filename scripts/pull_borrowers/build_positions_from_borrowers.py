#!/usr/bin/env python3
# Example:
# python3 scripts/pull_borrowers/build_positions_from_borrowers.py --chain sonic

from __future__ import annotations

import argparse
import json
import os
import time
from pathlib import Path
from typing import Any
from urllib import error, request

CHAIN_CONFIG: dict[str, dict[str, str | int]] = {
  "ethereum": {
    "chain_id": 1,
    "silo_lens": "0xC0e1bcFB1Ed68688B0d589A6807d05cF2D68b22b",
    "rpc_default": "https://eth.llamarpc.com",
    "rpc_env": "NEXT_PUBLIC_RPC_ETHEREUM",
  },
  "avalanche": {
    "chain_id": 43114,
    "silo_lens": "0xA0380d22A4Ee658e9706b390ddf9646f184dd521",
    "rpc_default": "https://avalanche-c-chain-rpc.publicnode.com",
    "rpc_env": "NEXT_PUBLIC_RPC_AVALANCHE",
  },
  "arbitrum": {
    "chain_id": 42161,
    "silo_lens": "0xF0B0218153633e6154c201d5A5d81128B0539336",
    "rpc_default": "https://arbitrum.drpc.org",
    "rpc_env": "NEXT_PUBLIC_RPC_ARBITRUM",
  },
  "sonic": {
    "chain_id": 146,
    "silo_lens": "0xB95AD415b0fcE49f84FbD5B26b14ec7cf4822c69",
    "rpc_default": "https://rpc.soniclabs.com",
    "rpc_env": "NEXT_PUBLIC_RPC_SONIC",
  },
}

MULTICALL3_BY_CHAIN_ID: dict[int, str] = {
  1: "0xca11bde05977b3631167028862be2a173976ca11",
  146: "0xca11bde05977b3631167028862be2a173976ca11",
  42161: "0xca11bde05977b3631167028862be2a173976ca11",
  43114: "0xca11bde05977b3631167028862be2a173976ca11",
}

SELECTOR_AGGREGATE3 = bytes.fromhex("82ad56cb")
SELECTOR_CALC_BORROW_VALUE = bytes.fromhex("8ec109da")
SELECTOR_CALC_COLLATERAL_VALUE = bytes.fromhex("dd718ab4")
SELECTOR_GET_USER_LTV = bytes.fromhex("43afdad2")
SELECTOR_GET_LT = bytes.fromhex("37febff4")


class RpcError(RuntimeError):
  pass


def load_env_file(path: str) -> None:
  env_path = Path(path)
  if not env_path.exists():
    return
  for raw_line in env_path.read_text(encoding="utf-8").splitlines():
    line = raw_line.strip()
    if not line or line.startswith("#") or "=" not in line:
      continue
    key, value = line.split("=", 1)
    key = key.strip()
    if not key:
      continue
    os.environ.setdefault(key, value.strip())


def normalize_address(value: str | None) -> str | None:
  if not value:
    return None
  v = value.strip().lower()
  if len(v) == 42 and v.startswith("0x"):
    return v
  return None


def encode_uint256(value: int) -> bytes:
  return value.to_bytes(32, byteorder="big", signed=False)


def decode_uint256(data: bytes) -> int:
  if len(data) < 32:
    return 0
  return int.from_bytes(data[:32], byteorder="big", signed=False)


def encode_bool(value: bool) -> bytes:
  return encode_uint256(1 if value else 0)


def encode_address(address: str) -> bytes:
  raw = bytes.fromhex(address[2:])
  return (b"\x00" * 12) + raw


def encode_bytes(value: bytes) -> bytes:
  padding = (32 - (len(value) % 32)) % 32
  return encode_uint256(len(value)) + value + (b"\x00" * padding)


def encode_call3_tuple(target: str, allow_failure: bool, call_data: bytes) -> bytes:
  head = encode_address(target) + encode_bool(allow_failure) + encode_uint256(96)
  tail = encode_bytes(call_data)
  return head + tail


def encode_aggregate3_calls(calls: list[dict[str, Any]]) -> str:
  encoded_items = [
    encode_call3_tuple(
      target=entry["target"],
      allow_failure=bool(entry["allowFailure"]),
      call_data=entry["callData"],
    )
    for entry in calls
  ]
  offsets_base = len(encoded_items) * 32
  offsets: list[int] = []
  running = offsets_base
  for item in encoded_items:
    offsets.append(running)
    running += len(item)

  array_payload = (
    encode_uint256(len(encoded_items))
    + b"".join(encode_uint256(offset) for offset in offsets)
    + b"".join(encoded_items)
  )
  data = SELECTOR_AGGREGATE3 + encode_uint256(32) + array_payload
  return "0x" + data.hex()


def decode_aggregate3_result(hex_data: str) -> list[tuple[bool, bytes]]:
  raw = bytes.fromhex(hex_data[2:] if hex_data.startswith("0x") else hex_data)
  if len(raw) < 64:
    return []
  root_offset = decode_uint256(raw[0:32])
  if root_offset + 32 > len(raw):
    return []
  array_len = decode_uint256(raw[root_offset : root_offset + 32])
  offsets_start = root_offset + 32
  out: list[tuple[bool, bytes]] = []

  for i in range(array_len):
    offset_pos = offsets_start + i * 32
    if offset_pos + 32 > len(raw):
      out.append((False, b""))
      continue
    entry_offset = decode_uint256(raw[offset_pos : offset_pos + 32])
    entry_start = offsets_start + entry_offset
    if entry_start + 64 > len(raw):
      out.append((False, b""))
      continue
    success = decode_uint256(raw[entry_start : entry_start + 32]) != 0
    data_offset = decode_uint256(raw[entry_start + 32 : entry_start + 64])
    data_start = entry_start + data_offset
    if data_start + 32 > len(raw):
      out.append((success, b""))
      continue
    data_len = decode_uint256(raw[data_start : data_start + 32])
    payload_start = data_start + 32
    payload_end = payload_start + data_len
    if payload_end > len(raw):
      out.append((success, b""))
      continue
    out.append((success, raw[payload_start:payload_end]))
  return out


def encode_two_address_call(selector: bytes, address_a: str, address_b: str) -> bytes:
  return selector + encode_address(address_a) + encode_address(address_b)


def encode_one_address_call(selector: bytes, address_a: str) -> bytes:
  return selector + encode_address(address_a)


def rpc_request(rpc_url: str, method: str, params: list[Any]) -> Any:
  payload = json.dumps({"jsonrpc": "2.0", "id": 1, "method": method, "params": params}).encode("utf-8")
  req = request.Request(
    url=rpc_url,
    data=payload,
    method="POST",
    headers={"Content-Type": "application/json", "Accept": "application/json"},
  )
  try:
    with request.urlopen(req, timeout=45) as response:
      parsed = json.loads(response.read().decode("utf-8"))
  except error.HTTPError as exc:
    body = exc.read().decode("utf-8", errors="replace")
    raise RpcError(f"RPC HTTP {exc.code}: {body}") from exc
  except error.URLError as exc:
    raise RpcError(f"RPC network error: {exc.reason}") from exc

  if "error" in parsed:
    raise RpcError(f"RPC error: {parsed['error']}")
  return parsed.get("result")


def run_multicall(
  rpc_url: str,
  multicall_address: str,
  calls: list[dict[str, Any]],
  chunk_size: int,
  label: str,
) -> list[tuple[bool, bytes]]:
  if not calls:
    return []
  out: list[tuple[bool, bytes]] = []
  total = len(calls)
  total_chunks = (total + chunk_size - 1) // chunk_size
  for start in range(0, total, chunk_size):
    chunk = calls[start : start + chunk_size]
    call_data = encode_aggregate3_calls(chunk)
    result_hex = rpc_request(
      rpc_url,
      "eth_call",
      [{"to": multicall_address, "data": call_data}, "latest"],
    )
    if not isinstance(result_hex, str):
      raise RpcError("Invalid eth_call result from multicall.")
    decoded = decode_aggregate3_result(result_hex)
    if len(decoded) != len(chunk):
      raise RpcError(f"Multicall result length mismatch: {len(decoded)} vs {len(chunk)}")
    out.extend(decoded)
    chunk_idx = start // chunk_size + 1
    print(f"[{label}] chunk {chunk_idx}/{total_chunks}: {len(chunk)} calls.")
  return out


def build_market_index(chain: str) -> dict[str, dict[str, Any]]:
  silos_path = Path(__file__).resolve().parents[2] / "src" / "data" / "liquidation" / "silos" / f"{chain}.json"
  payload = json.loads(silos_path.read_text(encoding="utf-8"))
  entries = payload.get("silos") or []
  market_index: dict[str, dict[str, Any]] = {}

  def add_entry(item: dict[str, Any]) -> None:
    silo_address = normalize_address(item.get("siloAddress"))
    silo_config_address = normalize_address(item.get("siloConfigAddress"))
    lt_value = (((item.get("siloConfig") or {}).get("lt")))
    if not silo_address:
      return
    market_index[silo_address] = {
      "silo_address": silo_address,
      "silo_config_address": silo_config_address,
      "lt": str(lt_value) if lt_value is not None else None,
    }

  for row in entries:
    if isinstance(row, dict):
      add_entry(row)
      other = row.get("otherSilo")
      if isinstance(other, dict):
        add_entry(other)
  return market_index


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description="Build positions metrics JSON from borrowers input using SiloLens multicall."
  )
  parser.add_argument("--chain", choices=sorted(CHAIN_CONFIG.keys()), required=True, help="Blockchain key.")
  parser.add_argument("--rpc-url", default=None, help="RPC URL override.")
  parser.add_argument("--silo-lens", default=None, help="SiloLens address override.")
  parser.add_argument("--chunk-size", type=int, default=180, help="Multicall chunk size.")
  parser.add_argument("--env-file", default=".env", help="Optional env file path.")
  return parser.parse_args()


def get_chain_runtime(chain: str, args: argparse.Namespace) -> tuple[int, str, str, str]:
  chain_cfg = CHAIN_CONFIG[chain]
  chain_id = int(chain_cfg["chain_id"])
  default_rpc = str(chain_cfg["rpc_default"])
  rpc_env_key = str(chain_cfg["rpc_env"])
  rpc_url = args.rpc_url or os.getenv(rpc_env_key, "").strip() or default_rpc
  lens_address = normalize_address(args.silo_lens or str(chain_cfg["silo_lens"]))
  if not lens_address:
    raise ValueError(f"Invalid SiloLens address for {chain}.")
  multicall_address = normalize_address(MULTICALL3_BY_CHAIN_ID.get(chain_id))
  if not multicall_address:
    raise ValueError(f"Missing multicall address for chain id {chain_id}.")
  return chain_id, rpc_url, lens_address, multicall_address


def read_borrowers(input_path: str) -> list[dict[str, Any]]:
  payload = json.loads(Path(input_path).read_text(encoding="utf-8"))
  if not isinstance(payload, list):
    raise ValueError("Borrowers input must be a JSON array.")
  rows: list[dict[str, Any]] = []
  for row in payload:
    if not isinstance(row, dict):
      continue
    account_id = normalize_address(str(row.get("account_id") or ""))
    debt_market_id = normalize_address(str(row.get("debt_market_id") or ""))
    if not account_id or not debt_market_id:
      continue
    rows.append(
      {
        "account_id": account_id,
        "debt_market_id": debt_market_id,
        "last_updated_timestamp": row.get("last_updated_timestamp"),
      }
    )
  return rows


def get_default_borrowers_input(chain: str) -> str:
  return str(Path(__file__).with_name(f"{chain}_borrowers.json"))


def load_legacy_whitelist_market_ids(chain: str) -> set[str] | None:
  path = (
    Path(__file__).resolve().parents[2]
    / "src"
    / "data"
    / "positions"
    / f"legacy_whitelist_{chain}.json"
  )
  if not path.exists():
    return None
  payload = json.loads(path.read_text(encoding="utf-8"))
  items: list[str]
  if isinstance(payload, list):
    items = [str(entry) for entry in payload]
  elif isinstance(payload, dict) and isinstance(payload.get("silos"), list):
    items = [str(entry) for entry in payload["silos"]]
  else:
    raise ValueError(f"Invalid whitelist format in {path}")
  normalized = {
    entry.strip().lower()
    for entry in items
    if isinstance(entry, str) and len(entry.strip()) == 42 and entry.strip().lower().startswith("0x")
  }
  return normalized


def filter_borrowers_by_legacy_whitelist(
  borrowers: list[dict[str, Any]], legacy_whitelist: set[str] | None
) -> list[dict[str, Any]]:
  if legacy_whitelist is None:
    return borrowers
  return [row for row in borrowers if row.get("debt_market_id") in legacy_whitelist]


def get_default_positions_output(chain: str) -> str:
  return str(Path(__file__).with_name(f"{chain}_positions.json"))


def get_default_public_positions_output(chain: str) -> Path:
  return Path(__file__).resolve().parents[2] / "public" / "liquidation" / "positions" / f"{chain}_positions.json"


def main() -> None:
  args = parse_args()
  load_env_file(args.env_file)
  chain = args.chain
  chain_id, rpc_url, lens_address, multicall_address = get_chain_runtime(chain, args)
  market_index = build_market_index(chain)
  input_path = get_default_borrowers_input(chain)
  output_path = get_default_positions_output(chain)
  public_output_path = get_default_public_positions_output(chain)
  borrowers = read_borrowers(input_path)
  legacy_whitelist = load_legacy_whitelist_market_ids(chain)
  borrowers = filter_borrowers_by_legacy_whitelist(borrowers, legacy_whitelist)
  generated_at = int(time.time())

  if not borrowers:
    Path(output_path).parent.mkdir(parents=True, exist_ok=True)
    Path(output_path).write_text("[]\n", encoding="utf-8")
    public_output_path.parent.mkdir(parents=True, exist_ok=True)
    public_output_path.write_text("[]\n", encoding="utf-8")
    print(f"No borrowers in input ({input_path}). Saved empty output.")
    print(f"Mirrored empty public output to {public_output_path}.")
    return

  positions: list[dict[str, Any]] = []
  for item in borrowers:
    market_meta = market_index.get(item["debt_market_id"])
    positions.append(
      {
        "chain": chain,
        "chain_id": chain_id,
        "account_id": item["account_id"],
        "debt_market_id": item["debt_market_id"],
        "silo_address": (market_meta or {}).get("silo_address"),
        "silo_config_address": (market_meta or {}).get("silo_config_address"),
        "collateral_value": None,
        "debt_value": None,
        "ltv": None,
        "lt": (market_meta or {}).get("lt"),
        "solvent": None,
        "age_timestamp": generated_at,
        "last_updated_timestamp": item.get("last_updated_timestamp"),
      }
    )

  # Fetch LT from SiloLens once per unique market silo.
  unique_silos = sorted({pos["silo_address"] for pos in positions if pos.get("silo_address")})
  lt_calls = [
    {
      "target": lens_address,
      "allowFailure": True,
      "callData": encode_one_address_call(SELECTOR_GET_LT, silo_address),
      "silo_address": silo_address,
    }
    for silo_address in unique_silos
  ]
  lt_results = run_multicall(rpc_url, multicall_address, lt_calls, args.chunk_size, "market LT")
  lt_by_silo: dict[str, str] = {}
  for i, (success, payload) in enumerate(lt_results):
    if not success:
      continue
    lt_by_silo[lt_calls[i]["silo_address"]] = str(decode_uint256(payload))

  # Build multicall payloads for borrower-level metrics.
  metric_calls: list[dict[str, Any]] = []
  metric_refs: list[tuple[int, str]] = []
  for index, pos in enumerate(positions):
    config_address = normalize_address(pos.get("silo_config_address"))
    silo_address = normalize_address(pos.get("silo_address"))
    account_address = normalize_address(pos.get("account_id"))
    if not config_address or not silo_address or not account_address:
      continue

    metric_calls.append(
      {
        "target": lens_address,
        "allowFailure": True,
        "callData": encode_two_address_call(SELECTOR_CALC_COLLATERAL_VALUE, config_address, account_address),
      }
    )
    metric_refs.append((index, "collateral_value"))

    metric_calls.append(
      {
        "target": lens_address,
        "allowFailure": True,
        "callData": encode_two_address_call(SELECTOR_CALC_BORROW_VALUE, config_address, account_address),
      }
    )
    metric_refs.append((index, "debt_value"))

    metric_calls.append(
      {
        "target": lens_address,
        "allowFailure": True,
        "callData": encode_two_address_call(SELECTOR_GET_USER_LTV, silo_address, account_address),
      }
    )
    metric_refs.append((index, "ltv"))

  metric_results = run_multicall(rpc_url, multicall_address, metric_calls, args.chunk_size, "borrower metrics")
  for i, (success, payload) in enumerate(metric_results):
    row_idx, field = metric_refs[i]
    if not success:
      continue
    positions[row_idx][field] = str(decode_uint256(payload))

  for row in positions:
    silo_address = normalize_address(row.get("silo_address"))
    if silo_address and silo_address in lt_by_silo:
      row["lt"] = lt_by_silo[silo_address]
    ltv_raw = row.get("ltv")
    lt_raw = row.get("lt")
    if isinstance(ltv_raw, str) and ltv_raw.isdigit() and isinstance(lt_raw, str) and lt_raw.isdigit():
      row["solvent"] = int(ltv_raw) <= int(lt_raw)
    else:
      row["solvent"] = None

  output_path_obj = Path(output_path)
  output_path_obj.parent.mkdir(parents=True, exist_ok=True)
  payload = json.dumps(positions, indent=2)
  output_path_obj.write_text(payload, encoding="utf-8")
  public_output_path.parent.mkdir(parents=True, exist_ok=True)
  public_output_path.write_text(payload, encoding="utf-8")
  print(f"Saved {len(positions)} position records to {output_path_obj}.")
  print(f"Mirrored {len(positions)} position records to {public_output_path}.")


if __name__ == "__main__":
  main()
