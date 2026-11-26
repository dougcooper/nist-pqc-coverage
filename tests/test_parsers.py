import json
from pathlib import Path

from nist_pqc import cavp, cmvp, esv, matching, normalize, policy

FIXTURES = Path(__file__).parent / "fixtures"


def read(name: str) -> str:
    return (FIXTURES / name).read_text(encoding="utf-8")


def test_parse_search_handles_vendor_rowspan():
    total, rows = cavp.parse_search(read("cavp_search.html"))
    assert total == 248
    assert len(rows) == 248
    assert rows[0].vendor == "Advanced Micro Devices (AMD)"
    assert rows[0].cert == "A8481"
    assert rows[0].validation_id == 41091
    assert rows[0].date == "6/3/2026"


def test_parse_detail_finds_header_and_pqc_rows():
    detail = cavp.parse_detail(read("cavp_detail.html"), "url")
    assert detail.cert == "A6184"
    assert detail.validation_id == 38794
    assert detail.vendor == "Amazon Web Services, Inc."
    assert detail.type == "SOFTWARE"
    assert detail.first_validated == "11/16/2024"
    assert detail.oe_ids == [28123, 29388]
    assert len(detail.pqc_rows) == 4
    assert {row.family for row in detail.pqc_rows} == {"ML-KEM"}
    assert all(row.cap_id for row in detail.pqc_rows)


def test_parse_dependencies_keeps_cpu_attributes():
    raw = json.loads(read("dep_29388.json"))
    deps = cavp.parse_dependencies(raw)
    assert deps["software"][0]["value"] == "Amazon Linux 2023 on EC2 bare metal"
    assert deps["processor"][0]["family"] == "ARM64"
    assert deps["processor"][0]["manufacturer"] == "Amazon"
    assert deps["processor"][0]["series"] == "Graviton4"


def test_parse_capabilities():
    raw = json.loads(read("cap_523657.json"))
    caps = cavp.parse_capabilities(raw)
    assert caps["curve"].startswith("P-224")
    assert caps["secret generation mode"] == "testing candidates"


def test_parse_cert_list():
    certs = cmvp.parse_cert_list(read("cmvp_all.html"))
    assert len(certs) == 763
    assert certs[0].cert == "5597"
    assert certs[0].vendor == "IDEMIA"
    assert certs[1].cert == "5596"


def test_parse_cert():
    cert = cmvp.parse_cert(read("cmvp_cert.html"), "5596", "url")
    assert cert.vendor == "Amazon Web Services, Inc."
    assert cert.module == "AWS-LC 4 Cryptographic Module (static)"
    assert cert.standard == "FIPS 140-3"
    assert cert.status == "Active"
    assert cert.level == "1"
    assert cert.module_type == "Software"
    assert cert.validated == "11/19/2026"
    assert len(cert.algorithms) > 400
    assert cert.has_pqc
    assert {a.algorithm for a in cert.pqc_algorithms} >= {"ML-DSA KeyGen"}
    assert cert.security_policy_url.endswith("140sp5596.pdf")


def test_parse_esv_search():
    total, rows = esv.parse_search(read("esv_search.html"))
    assert total == 366
    assert len(rows) == 3
    assert rows[0].cert == "E1"
    assert rows[0].vendor == "NetApp, Inc."
    assert rows[0].implementation == "NetApp CryptoMod"
    assert rows[0].date == "8/29/2022"
    assert rows[0].url.endswith("/entropy-validations/certificate/1")


def test_parse_esv_cert():
    cert = esv.parse_cert(read("esv_cert.html"), "E11", "url")
    assert cert.vendor == "STMicroelectronics"
    assert cert.vendor_url == "http://www.st.com"
    assert cert.implementation == "STM32U5x TRNG"
    assert cert.standard == "SP 800-90B"
    assert cert.version == "Revision B"
    assert cert.noise_source == "Physical"
    assert cert.reuse_status == "Open for Reuse"
    assert cert.open_for_reuse
    assert cert.bits_per_output == "Full entropy"
    assert cert.output_size_bits == "128"
    assert cert.operating_environments == [
        "STM32U5x advanced Arm\u00ae-based 32-bit MCU"
    ]
    assert cert.conditioning_cavp_certs == ["A1729 (AES-CMAC)"]
    assert cert.validated == "12/16/2022"
    assert cert.last_validated == "12/16/2022"
    assert cert.lab == "UL Verification Services, Inc."
    assert cert.public_use_document_url.endswith("E11_PublicUse.docx")


def test_parse_esv_entropy_per_sample():
    assert esv._entropy("Entropy per Sample: 0.52427 Sample Size: 1") == (
        "0.52427",
        "1",
    )


def test_parse_in_process_lists():
    mip = cmvp.parse_mip(read("mip.html"))
    assert len(mip) == 178
    assert mip[0].status == "Comment Resolution - Lab"
    assert mip[0].status_date == "9/10/2026"
    assert "View Contacts" not in mip[0].vendor

    iut = cmvp.parse_iut(read("iut.html"))
    assert len(iut) == 221
    assert iut[0].status == "IUT"
    assert iut[0].status_date == "6/10/2026"


def test_normalize_linux_arm():
    deps = cavp.parse_dependencies(json.loads(read("dep_29388.json")))
    record = normalize.normalize_oe(
        "Amazon Linux 2023 on EC2 bare metal on Amazon Graviton4 AWS Graviton", deps
    )
    assert record["os_family"] == "linux"
    assert record["os_name"] == "Amazon Linux 2023"
    assert record["os_product"] == "Amazon Linux"
    assert record["os_version"] == "2023"
    assert record["arch"] == "arm64"
    assert record["cpu_vendor"] == "aws"


def test_normalize_windows_x86():
    record = normalize.normalize_oe(
        "Windows Server 2022 on Intel Xeon Platinum 8380",
        {
            "software": [{"value": "Windows Server 2022"}],
            "processor": [
                {
                    "value": "Xeon Platinum 8380",
                    "family": "X86",
                    "manufacturer": "Intel",
                }
            ],
        },
    )
    assert record["os_family"] == "windows"
    assert record["os_product"] == "Windows Server"
    assert record["os_version"] == "2022"
    assert record["arch"] == "x86_64"
    assert record["cpu_vendor"] == "intel"


def test_normalize_runtime_clause_and_core_cpu():
    record = normalize.normalize_oe(
        "Ubuntu 22.04 LTS with Java SE Runtime Environment v8 (1.8) on "
        "11th Generation Intel\u00ae Core\u2122 i7 Processors without PAA",
        {
            "software": [
                {"value": "Ubuntu 22.04 LTS with Java SE Runtime Environment v8 (1.8)"}
            ],
            "processor": [
                {
                    "value": "11th Generation Intel\u00ae Core\u2122 i7 Processors",
                    "manufacturer": "Intel",
                }
            ],
        },
    )
    assert record["os_family"] == "linux"
    assert record["os_name"] == "Ubuntu 22.04 LTS"
    assert record["os_product"] == "Ubuntu"
    assert record["os_version"] == "22.04 LTS"
    assert record["arch"] == "x86_64"
    assert record["cpu_vendor"] == "intel"


def test_policy_sections_and_candidates():
    text = (FIXTURES / "policy_5596_excerpt.txt").read_text()
    sections = policy.split_sections(text)
    kinds = [section.kind for section in sections]
    assert kinds == ["tested", "vendor_affirmed"]
    tested = sections[0]
    assert tested.embodiment == "Software, Firmware, Hybrid"
    assert "Operating" in tested.text
    assert "Graviton4" in tested.cpu_candidates
    assert "Linux" in tested.os_candidates
    assert "N/A for this module." in sections[1].text


def test_policy_ignores_unrelated_heading():
    text = (
        "Tested Operational Environment\u2019s Physical Perimeter (TOEPP)\n"
        "The TOEPP is the general-purpose computer on which the module is installed.\n"
    )
    assert policy.split_sections(text) == []


def test_normalize_rhel_and_bare_metal():
    rhel = normalize.normalize_oe(
        "Red Hat Enterprise Linux 9.4", {"software": [{"value": "Red Hat Enterprise Linux 9.4"}]}
    )
    assert rhel["os_family"] == "linux"
    assert rhel["os_product"] == "Red Hat Enterprise Linux"
    assert rhel["os_version"] == "9.4"

    bare = normalize.normalize_oe("N/A", {"hardware": [{"value": "N/A"}]})
    assert bare["os_family"] == "none"
    assert bare["os_name"] == ""


def test_normalize_hardware_only_environment():
    record = normalize.normalize_oe(
        "Xilinx Zynq Ultrascale+ ZU9EG",
        {
            "processor": [
                {
                    "value": "ZU9EG",
                    "family": "Ultrascale+",
                    "manufacturer": "Xilinx Zynq",
                    "series": "Ultrascale+",
                }
            ]
        },
    )
    assert record["os_family"] == "none"
    assert record["os_name"] == ""
    assert record["arch"] == "arm64"
    assert record["cpu_vendor"] == "xilinx"
    assert record["target"] == "arm64"


def test_families():
    assert cavp.family_of("ML-KEM EncapDecap") == "ML-KEM"
    assert cavp.family_of("SLH-DSA SigGen") == "SLH-DSA"
    assert cavp.family_of("AES") == ""
    assert cavp.family_from_text("ML-DSA KeyGen") == "ML-DSA"
    assert cavp.family_from_text("Kyber") == "ML-KEM"
    assert cavp.looks_pqc("Post-Quantum module")


def test_matching_helpers():
    assert matching.vendors_match("Amazon Web Services, Inc.", "Amazon Web Services, Inc")
    assert not matching.vendors_match("Intel Corporation", "Amazon Web Services")
    assert matching.name_score(
        "AWS-LC 4 Cryptographic Module (static)",
        "AWS-LC Cryptographic Module (dynamic build) (C_SHA)",
    ) >= 0.5


def test_match_in_process():
    detail = cavp.CavpDetail(
        cert="A1",
        validation_id=1,
        implementation="AWS-LC Cryptographic Module (dynamic build)",
        version="",
        type="SOFTWARE",
        description="",
        vendor="Amazon Web Services, Inc.",
        first_validated="",
        url="",
    )
    evidence, score, matched = matching.match_in_process(
        "AWS-LC 4 Cryptographic Module (static)", "Amazon Web Services, Inc", [detail]
    )
    assert evidence == "cavp_name_match"
    assert score >= 0.5
    assert matched == [detail]

    evidence, _, matched = matching.match_in_process(
        "Some ML-KEM Module", "Acme Corp", [detail]
    )
    assert evidence == "name_keyword"
    assert matched == []


def test_coverage_targets_and_greedy():
    from nist_pqc import export

    rows = [
        {"source": "CAVP", "record_id": "A1", "vendor": "A", "product": "P1",
         "os_name": "Linux", "arch": "x86_64", "os_family": "linux"},
        {"source": "CAVP", "record_id": "A1", "vendor": "A", "product": "P1",
         "os_name": "Windows", "arch": "x86_64", "os_family": "windows"},
        {"source": "CAVP", "record_id": "A2", "vendor": "B", "product": "P2",
         "os_name": "Linux", "arch": "x86_64", "os_family": "linux"},
    ]
    targets = export.coverage_targets(rows, "validated")
    assert [t["os_name"] for t in targets] == ["Linux", "Windows"]
    assert targets[0]["vendors"] == 2
    assert targets[0]["cumulative_products"] == 2
    assert targets[1]["cumulative_pct_products"] == 100.0

    greedy = export.coverage_greedy(rows, "validated")
    assert len(greedy) == 1
    assert greedy[0]["product"] == "P1"
    assert greedy[0]["targets_covered"] == 2
    assert greedy[-1]["pct_targets"] == 100.0


def test_module_kind_normalizes_cavp_and_cmvp_spellings():
    assert normalize.module_kind_of("SOFTWARE") == "software"
    assert normalize.module_kind_of("Software") == "software"
    assert normalize.module_kind_of("SW Hybrid") == "software_hybrid"
    assert normalize.module_kind_of("Software-hybrid") == "software_hybrid"
    assert normalize.module_kind_of("FIRMWARE") == "firmware"
    assert normalize.module_kind_of("Firmware-hybrid") == "firmware_hybrid"
    assert normalize.module_kind_of("HARDWARE") == "hardware"
    assert normalize.module_kind_of("") == ""
    assert normalize.module_kind_of(None) == ""
