from nist_pqc.platforms import FAMILIES, build_platforms


def esv_row(
    cert: str,
    environments: str,
    *,
    vendor: str = "Vendor",
    reuse: str = "Open for Reuse",
    noise: str = "Physical",
) -> dict:
    return {
        "cert": cert,
        "implementation": f"Source {cert}",
        "vendor": vendor,
        "reuse_status": reuse,
        "noise_source": noise,
        "bits_per_output": "Full entropy" if noise == "Physical" else "0.5",
        "output_size_bits": "256",
        "validated": "2026-01-01",
        "last_validated": "2026-01-01",
        "public_use_document_url": f"https://example.test/{cert}.pdf",
        "url": f"https://example.test/{cert}",
        "operating_environments": environments,
    }


def test_groups_certificates_and_keeps_matched_environments():
    rows = [
        esv_row(
            "E2",
            "STM32MP1; Generic Arm Cortex-M33",
            vendor="Second",
            reuse="Reuse restricted to vendor",
            noise="Non-Physical",
        ),
        esv_row("E1", "STM32U5; STM32H5; Generic Arm Cortex-M33"),
        esv_row("E3", "R7FA4M2"),
        esv_row("E4", "Mystery 9000"),
    ]

    families, certs, unmapped = build_platforms(rows)
    by_name = {row["family"]: row for row in families}

    assert set(by_name) == {"STM32", "Renesas RA"}
    assert [row["cert"] for row in unmapped] == ["E4"]
    assert unmapped[0]["operating_environments"] == "Mystery 9000"
    assert by_name["STM32"]["open_physical"] == 1
    assert by_name["STM32"]["esv_certs"] == 2
    assert by_name["STM32"]["open"] == 1
    assert by_name["STM32"]["physical"] == 1
    assert by_name["STM32"]["entropy_vendors"] == 2
    assert by_name["STM32"]["environments"] == 3
    assert "STM32MP1" in by_name["STM32"]["example_environments"]

    stm32 = [row for row in certs if row["family"] == "STM32"]
    assert [row["cert"] for row in stm32] == ["E1", "E2"]
    assert stm32[0]["matched_environments"] == "STM32U5; STM32H5"
    assert stm32[1]["matched_environments"] == "STM32MP1"
    assert stm32[0]["platform_vendor"] == "STMicroelectronics"


def test_apple_requires_apple_in_the_environment():
    families, certs, unmapped = build_platforms(
        [
            esv_row("E1", "M1"),
            esv_row("E2", "Apple M2"),
        ]
    )
    by_name = {row["family"]: row for row in families}

    assert set(by_name) == {"Apple A / M / S"}
    assert by_name["Apple A / M / S"]["esv_certs"] == 1
    assert [row["cert"] for row in certs] == ["E2"]
    assert [row["cert"] for row in unmapped] == ["E1"]


def test_no_matches_is_empty():
    families, certs, unmapped = build_platforms([esv_row("E1", "Mystery 9000")])
    assert families == []
    assert certs == []
    assert [row["cert"] for row in unmapped] == ["E1"]


def test_server_and_security_chipsets_are_captured():
    rows = [
        esv_row("E1", "Intel Xeon Gold 6226"),
        esv_row("E2", "AMD EPYC 9xx4"),
        esv_row("E3", "IBM POWER10"),
        esv_row("E4", "Ampere Altra Q80-30"),
        esv_row("E5", "ST33G1M2A revision F"),
        esv_row("E6", "QS7001 Rev. C"),
    ]

    families, _, unmapped = build_platforms(rows)
    by_name = {row["family"]: row for row in families}

    assert set(by_name) == {
        "Intel x86",
        "AMD x86",
        "IBM POWER",
        "Arm server",
        "ST33 TPM",
        "SEALSQ QS7001",
    }
    assert unmapped == []


def test_variant_patterns_cover_slc_space_s4lv_and_zc706():
    rows = [
        esv_row("E1", "S4LV006X02"),
        esv_row("E2", "SLC 26 32-bit Security Controller V19"),
        esv_row("E3", "Xilinx ZC706 Evaluation kit"),
    ]

    families, _, _ = build_platforms(rows)
    by_name = {row["family"]: row for row in families}

    assert set(by_name) == {
        "Samsung Exynos / custom",
        "Infineon security controller",
        "Xilinx Zynq / UltraScale",
    }


def test_family_config_loads_and_has_unique_names():
    assert FAMILIES
    names = [family.name for family in FAMILIES]
    assert len(names) == len(set(names))
    assert all(family.pattern for family in FAMILIES)
