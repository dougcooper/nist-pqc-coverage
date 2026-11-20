"""Convert the CSV dataset to Parquet for the dashboard's DuckDB client.

The CSVs stay the committed source of truth; Parquet is a build artifact. DuckDB
infers the column types by scanning every row, so ISO dates become DATE and
counts become BIGINT without a hand-maintained schema.
"""

from __future__ import annotations

from pathlib import Path

import duckdb


def convert(csv_path: Path, parquet_path: Path) -> None:
    """Write one CSV file to Parquet, zstd-compressed."""
    parquet_path.parent.mkdir(parents=True, exist_ok=True)
    con = duckdb.connect()
    try:
        con.execute(
            """
            COPY (
                SELECT * FROM read_csv(
                    ?,
                    header = true,
                    sample_size = -1,
                    nullstr = ['']
                )
            ) TO ? (FORMAT PARQUET, COMPRESSION ZSTD)
            """,
            [str(csv_path), str(parquet_path)],
        )
    finally:
        con.close()


def convert_dir(csv_dir: Path, out_dir: Path) -> list[Path]:
    """Convert every ``*.csv`` in ``csv_dir``; return the files written."""
    written = []
    for csv_path in sorted(csv_dir.glob("*.csv")):
        parquet_path = out_dir / f"{csv_path.stem}.parquet"
        convert(csv_path, parquet_path)
        written.append(parquet_path)
    return written


def row_count(path: Path) -> int:
    con = duckdb.connect()
    try:
        return con.execute(
            "SELECT count(*) FROM read_parquet(?)", [str(path)]
        ).fetchone()[0]
    finally:
        con.close()
