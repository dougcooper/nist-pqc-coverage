import duckdb

from nist_pqc import parquet


def test_convert_infers_dates_and_counts(tmp_path):
    csv_path = tmp_path / "sample.csv"
    csv_path.write_text(
        "id,label,day,count\n"
        "1,alpha,2026-01-02,3\n"
        "2,,2026-03-04,\n"
    )

    out = tmp_path / "sample.parquet"
    parquet.convert(csv_path, out)
    assert parquet.row_count(out) == 2

    con = duckdb.connect()
    try:
        columns = {
            row[0]: row[1]
            for row in con.execute(
                "DESCRIBE SELECT * FROM read_parquet(?)", [str(out)]
            ).fetchall()
        }
        labels = con.execute(
            "SELECT label FROM read_parquet(?) ORDER BY id", [str(out)]
        ).fetchall()
    finally:
        con.close()

    assert columns["day"] == "DATE"
    assert columns["count"] == "BIGINT"
    # Empty strings read back as NULL rather than an empty string.
    assert labels == [("alpha",), (None,)]


def test_convert_dir_writes_every_csv(tmp_path):
    source = tmp_path / "csv"
    source.mkdir()
    (source / "a.csv").write_text("x\n1\n")
    (source / "b.csv").write_text("y\n2\n")

    written = parquet.convert_dir(source, tmp_path / "out")

    assert [path.name for path in written] == ["a.parquet", "b.parquet"]
    assert all(path.exists() for path in written)
