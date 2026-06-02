#!/usr/bin/env python3
# Example:
# THE_GRAPH_API_KEY=your_api_key python3 scripts/pull_borrowers/fetch_legacy_borrowers.py --chain sonic

from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
from typing import Any
from urllib import error, request

CHAIN_CONFIG: dict[str, dict[str, str | int]] = {
  "ethereum": {
    "chain_id": 1,
    "subgraph_url": "https://gateway.thegraph.com/api/subgraphs/id/2z5Mn4WW7K4yR1iH9KdignREkTq9EM1S4GX3yLaztRFg",
  },
  "avalanche": {
    "chain_id": 43114,
    "subgraph_url": "https://gateway.thegraph.com/api/subgraphs/id/6NLL9WmjPYima4NhUpNEWeDu5eBXFuhP9QheRXkoJXR5",
  },
  "arbitrum": {
    "chain_id": 42161,
    "subgraph_url": "https://gateway.thegraph.com/api/subgraphs/id/DK5qWsSJSqkeW2GHDQQCB7xHnHwVN3K1LPpP6CYNXMh8",
  },
  "sonic": {
    "chain_id": 146,
    "subgraph_url": "https://gateway.thegraph.com/api/subgraphs/id/8wcbzcdNirQvk1ETh25wpVzb5GWs8DvugpbwrYnTCcxj",
  },
}
DEFAULT_CHAIN = "sonic"

POSITIONS_QUERY_API_V3 = """
query BorrowersByChain($first: Int!, $skip: Int!, $chainId: Int!) {
  positions(
    where: { chainId: $chainId, isOpen: true, ltv_gt: "0" }
    orderBy: "debtValue"
    orderDirection: "desc"
    limit: $first
    offset: $skip
  ) {
    items {
      id
      accountId
      marketId
      lastUpdatedTimestamp
    }
    pageInfo {
      hasNextPage
    }
  }
}
"""

POSITIONS_QUERY_API_V3_WITH_WHITELIST = """
query BorrowersByChain($first: Int!, $skip: Int!, $chainId: Int!, $marketIds: [String!]) {
  positions(
    where: { chainId: $chainId, isOpen: true, ltv_gt: "0", marketId_in: $marketIds }
    orderBy: "debtValue"
    orderDirection: "desc"
    limit: $first
    offset: $skip
  ) {
    items {
      id
      accountId
      marketId
      lastUpdatedTimestamp
    }
    pageInfo {
      hasNextPage
    }
  }
}
"""

POSITIONS_QUERY_WITH_RECORD_TIMESTAMP = """
query Borrowers($first: Int!, $skip: Int!) {
  _meta {
    block {
      number
      timestamp
    }
  }
  positions(first: $first, skip: $skip, where: { dTokenBalance_gt: 0 }) {
    id
    account {
      id
    }
    market {
      id
      silo {
        id
        market1 {
          id
        }
        market2 {
          id
        }
      }
    }
    lastUpdatedTimestamp
  }
}
"""

POSITIONS_QUERY_WITH_RECORD_TIMESTAMP_WHITELIST = """
query Borrowers($first: Int!, $skip: Int!, $marketIds: [String!]) {
  _meta {
    block {
      number
      timestamp
    }
  }
  positions(first: $first, skip: $skip, where: { dTokenBalance_gt: 0, market_in: $marketIds }) {
    id
    account {
      id
    }
    market {
      id
      silo {
        id
        market1 {
          id
        }
        market2 {
          id
        }
      }
    }
    lastUpdatedTimestamp
  }
}
"""

POSITIONS_QUERY_SNAPSHOT_TIMESTAMP_ONLY = """
query Borrowers($first: Int!, $skip: Int!) {
  _meta {
    block {
      number
      timestamp
    }
  }
  positions(first: $first, skip: $skip, where: { dTokenBalance_gt: 0 }) {
    id
    account {
      id
    }
    market {
      id
      silo {
        id
        market1 {
          id
        }
        market2 {
          id
        }
      }
    }
  }
}
"""

POSITIONS_QUERY_SNAPSHOT_TIMESTAMP_ONLY_WHITELIST = """
query Borrowers($first: Int!, $skip: Int!, $marketIds: [String!]) {
  _meta {
    block {
      number
      timestamp
    }
  }
  positions(first: $first, skip: $skip, where: { dTokenBalance_gt: 0, market_in: $marketIds }) {
    id
    account {
      id
    }
    market {
      id
      silo {
        id
        market1 {
          id
        }
        market2 {
          id
        }
      }
    }
  }
}
"""


class GraphqlRequestError(RuntimeError):
  def __init__(self, message: str, errors: list[dict[str, Any]] | None = None) -> None:
    super().__init__(message)
    self.errors = errors or []


def get_chain_id(chain: str) -> int:
  return int(CHAIN_CONFIG[chain]["chain_id"])


def get_default_graphql_url(chain: str) -> str:
  return str(CHAIN_CONFIG[chain]["subgraph_url"])


def get_default_whitelist_path(chain: str) -> str:
  repo_root = Path(__file__).resolve().parents[2]
  return str(
    repo_root / "src" / "data" / "positions" / f"legacy_whitelist_{chain}.json"
  )


def get_default_output_path(chain: str) -> str:
  return str(Path(__file__).with_name(f"{chain}_borrowers.json"))


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


def resolve_api_key(cli_value: str | None) -> str | None:
  if cli_value and cli_value.strip():
    return cli_value.strip()
  return (
    os.getenv("THE_GRAPH_API_KEY", "").strip()
    or os.getenv("GRAPH_API_KEY", "").strip()
    or None
  )


def build_headers(api_key: str | None) -> dict[str, str]:
  headers = {
    "Content-Type": "application/json",
    "Accept": "*/*",
    # The Graph gateway may reject urllib default user agent (403 / code 1010).
    "User-Agent": "python-requests/2.31.0",
  }
  if api_key:
    headers["Authorization"] = f"Bearer {api_key}"
  return headers


def post_graphql(
  url: str, headers: dict[str, str], query: str, variables: dict[str, Any]
) -> dict[str, Any]:
  payload_raw = json.dumps({"query": query, "variables": variables}).encode("utf-8")
  req = request.Request(
    url=url,
    data=payload_raw,
    headers=headers,
    method="POST",
  )
  try:
    with request.urlopen(req, timeout=30) as response:
      payload = json.loads(response.read().decode("utf-8"))
  except error.HTTPError as exc:
    response_body = exc.read().decode("utf-8", errors="replace")
    hint = ""
    if exc.code == 403:
      hint = (
        " (Forbidden: verify THE_GRAPH_API_KEY / --api-key. "
        "The Graph gateway subgraph-id endpoints require a valid bearer token.)"
      )
    raise GraphqlRequestError(
      f"HTTP {exc.code} while calling GraphQL endpoint: {response_body}{hint}"
    ) from exc
  except error.URLError as exc:
    raise GraphqlRequestError(f"Network error while calling GraphQL endpoint: {exc.reason}") from exc

  if "errors" in payload:
    raise GraphqlRequestError("GraphQL request returned errors.", payload["errors"])
  data = payload.get("data")
  if not isinstance(data, dict):
    raise GraphqlRequestError("GraphQL response is missing data.")
  return data


def extract_debt_market_id(position: dict[str, Any]) -> str | None:
  market = position.get("market") or {}
  market_id = market.get("id")
  silo = market.get("silo") or {}
  market1_id = (silo.get("market1") or {}).get("id")
  market2_id = (silo.get("market2") or {}).get("id")

  if market_id == market1_id:
    return market1_id
  if market_id == market2_id:
    return market2_id
  if market_id:
    return market_id
  return market1_id or market2_id


def normalize_timestamp(value: Any) -> int | str | None:
  if value is None:
    return None
  if isinstance(value, int):
    return value
  if isinstance(value, str):
    raw = value.strip()
    if raw.isdigit():
      return int(raw)
    if raw:
      return raw
  return None


def load_silo_whitelist(path: str) -> tuple[set[str] | None, bool]:
  whitelist_path = Path(path)
  if not whitelist_path.exists():
    return None, False

  payload = json.loads(whitelist_path.read_text(encoding="utf-8"))
  items: list[str]
  if isinstance(payload, list):
    items = [str(entry) for entry in payload]
  elif isinstance(payload, dict) and isinstance(payload.get("silos"), list):
    items = [str(entry) for entry in payload["silos"]]
  else:
    raise ValueError(
      f"Invalid whitelist format in {whitelist_path}. Expected JSON array or object with 'silos' array."
    )

  normalized = {
    entry.strip().lower()
    for entry in items
    if isinstance(entry, str) and entry.strip()
  }
  return normalized, True


def fetch_borrowers(
  graphql_url: str,
  chain_id: int,
  headers: dict[str, str],
  batch_size: int,
  whitelist_silos: set[str] | None,
) -> list[dict[str, Any]]:
  skip = 0
  page = 0
  borrowers: list[dict[str, Any]] = []
  use_api_v3_query = "api-v3.silo.finance/graphql" in graphql_url
  use_record_timestamp = True
  whitelist_market_ids = sorted(whitelist_silos) if whitelist_silos else None

  while True:
    page += 1
    if use_api_v3_query:
      try:
        query = POSITIONS_QUERY_API_V3_WITH_WHITELIST if whitelist_market_ids else POSITIONS_QUERY_API_V3
        variables = {"first": batch_size, "skip": skip, "chainId": chain_id}
        if whitelist_market_ids:
          variables["marketIds"] = whitelist_market_ids
        data = post_graphql(
          graphql_url,
          headers,
          query,
          variables,
        )
      except GraphqlRequestError as exc:
        if exc.errors:
          print("API V3 query is not supported for this endpoint; falling back to subgraph query.")
          use_api_v3_query = False
          continue
        raise

      positions = ((data.get("positions") or {}).get("items")) or []
      if not positions:
        break

      for position in positions:
        account_id = (position.get("accountId") or "").lower()
        debt_market_id = (position.get("marketId") or "").lower()
        if not account_id or not debt_market_id:
          continue
        borrowers.append(
          {
            "account_id": account_id,
            "debt_market_id": debt_market_id,
            "last_updated_timestamp": normalize_timestamp(position.get("lastUpdatedTimestamp")),
          }
        )

      print(f"Page {page} fetched {len(positions)}; total {len(borrowers)}.")
      has_next_page = bool(((data.get("positions") or {}).get("pageInfo") or {}).get("hasNextPage"))
      if not has_next_page or len(positions) < batch_size:
        break
      skip += batch_size
      continue

    variables: dict[str, Any] = {"first": batch_size, "skip": skip}
    if whitelist_market_ids:
      variables["marketIds"] = whitelist_market_ids
    query = (
      POSITIONS_QUERY_WITH_RECORD_TIMESTAMP_WHITELIST
      if use_record_timestamp and whitelist_market_ids
      else POSITIONS_QUERY_WITH_RECORD_TIMESTAMP
      if use_record_timestamp
      else POSITIONS_QUERY_SNAPSHOT_TIMESTAMP_ONLY_WHITELIST
      if whitelist_market_ids
      else POSITIONS_QUERY_SNAPSHOT_TIMESTAMP_ONLY
    )
    try:
      data = post_graphql(graphql_url, headers, query, variables)
    except GraphqlRequestError as exc:
      if use_record_timestamp and any(
        "lastUpdatedTimestamp" in (err.get("message") or "") for err in exc.errors
      ):
        print("Field lastUpdatedTimestamp is unavailable; using _meta.block.timestamp fallback.")
        use_record_timestamp = False
        continue
      raise

    positions = data.get("positions") or []
    if not positions:
      break

    snapshot_ts = normalize_timestamp(
      (((data.get("_meta") or {}).get("block") or {}).get("timestamp"))
    )

    for position in positions:
      account_id = ((position.get("account") or {}).get("id") or "").lower()
      if not account_id:
        continue
      debt_market_id = extract_debt_market_id(position)
      if not debt_market_id:
        continue
      record_timestamp = normalize_timestamp(position.get("lastUpdatedTimestamp")) or snapshot_ts
      borrowers.append(
        {
          "account_id": account_id,
          "debt_market_id": debt_market_id.lower(),
          "last_updated_timestamp": record_timestamp,
        }
      )

    print(f"Page {page} fetched {len(positions)}; total {len(borrowers)}.")
    if len(positions) < batch_size:
      break
    skip += batch_size

  return borrowers


def parse_args() -> argparse.Namespace:
  parser = argparse.ArgumentParser(
    description="Fetch borrowers from The Graph and write them to JSON."
  )
  parser.add_argument(
    "--chain",
    choices=sorted(CHAIN_CONFIG.keys()),
    default=DEFAULT_CHAIN,
    help="Blockchain to fetch (default: sonic).",
  )
  parser.add_argument("--graphql-url", default=None, help="GraphQL endpoint URL override.")
  parser.add_argument(
    "--whitelist-file",
    default=None,
    help="Path to whitelist JSON file (default: src/data/positions/legacy_whitelist_<chain>.json).",
  )
  parser.add_argument(
    "--env-file",
    default=".env",
    help="Optional env file loaded before resolving API keys (default: .env).",
  )
  parser.add_argument(
    "--api-key",
    default=None,
    help="Optional API key for The Graph gateway endpoints (fallback: THE_GRAPH_API_KEY/GRAPH_API_KEY).",
  )
  parser.add_argument(
    "--batch-size",
    type=int,
    default=1000,
    help="Number of records fetched per GraphQL page.",
  )
  return parser.parse_args()


def main() -> None:
  args = parse_args()
  load_env_file(args.env_file)
  api_key = resolve_api_key(args.api_key)
  headers = build_headers(api_key)
  chain = args.chain
  chain_id = get_chain_id(chain)
  graphql_url = args.graphql_url or get_default_graphql_url(chain)
  whitelist_file = args.whitelist_file or get_default_whitelist_path(chain)
  output = get_default_output_path(chain)

  whitelist_silos, whitelist_exists = load_silo_whitelist(whitelist_file)
  if whitelist_exists:
    if whitelist_silos:
      print(f"Whitelist enabled for {chain}: {len(whitelist_silos)} market id(s) from {whitelist_file}.")
    else:
      print(f"Whitelist file {whitelist_file} is empty. Returning zero records.")
      whitelist_silos = set()
  else:
    print(f"Whitelist file {whitelist_file} not found for {chain}. Fetching all silos.")

  if whitelist_exists and whitelist_silos == set():
    borrowers: list[dict[str, Any]] = []
  else:
    borrowers = fetch_borrowers(graphql_url, chain_id, headers, args.batch_size, whitelist_silos)

  output_path = Path(output)
  output_path.parent.mkdir(parents=True, exist_ok=True)
  output_path.write_text(json.dumps(borrowers, indent=2), encoding="utf-8")
  print(f"Saved {len(borrowers)} {chain} borrower records to {output_path}.")


if __name__ == "__main__":
  main()
