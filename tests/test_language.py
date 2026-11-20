from nist_pqc.language import classify


def test_stated_languages():
    assert classify("implemented in pure Java with hardware augmentation").name == "Java"
    assert classify("implemented in pure C#. All key sizes").name == "C#"
    assert classify("written in the Go programming language").name == "Go"
    assert classify("written in C programming language for use by applications").name == "C"
    assert classify("written in generic C").name == "C"
    assert classify("written in JavaScript").name == "JavaScript"
    assert classify("written in Objective-C").name == "Objective-C"


def test_source_is_stated_when_nist_says_it():
    assert classify("implemented in pure Java").source == "stated"
    assert classify("written in C").source == "stated"


def test_ignores_interface_language_and_caller_wording():
    # "C language API" describes the interface, not the implementation.
    assert classify("provides a C language Application Program Interface").name == ""
    # The module is usable by applications written in C; it is not necessarily C.
    assert classify("usable by applications written in C").name == ""
    # "implemented in" followed by an embodiment is not a language.
    assert classify("implemented in a multi chip embedded hardware module").name == ""
    assert classify("implemented in firmware and hardware").name == ""


def test_phrases_that_state_the_language():
    assert classify("an implementation in Rust").name == "Rust"
    assert classify("Rust implementation of post-quantum cryptography").name == "Rust"
    assert classify("liboqs is an open source C library").name == "C"
    assert classify("a portable C90 implementation").name == "C"
    assert classify("an optimized assembly implementation").name == "Assembly"
    # "C language API" is still an interface, not an implementation.
    assert classify("a C language API for applications").name == ""


def test_product_name_rules():
    assert classify("", "Geomys LLC", "Go Cryptographic Module").name == "Go"
    assert classify("", "Dell", "Dell BSAFE Crypto Module for Java").name == "Java"
    assert classify(
        "", "Legion of the Bouncy Castle", "BC-FNA (Bouncy Castle FIPS .NET 4.8 API)"
    ).name == "C#"
    assert classify("", "atsec corp.", "leancrypto (C)").name == "C"
    assert classify("", "PQSecure Technologies, LLC", "Libpqsecure-rs").name == "Rust"
    assert classify("", "Dell", "Dell BSAFE Crypto Module for C v3.1").name == "C"


def test_go_product_name_needs_a_go_vendor():
    # "Access Point Go" is a product name, not the Go language.
    assert classify("", "", "Access Point Go Cryptographic Module").name == ""
    assert classify("", "Virtru Corporation", "Virtru Go Cryptographic Module").name == "Go"


def test_curated_upstream_map():
    assert classify("", "Amazon Web Services, Inc.", "AWS-LC 4 Cryptographic Module").name == "C"
    assert classify("", "The OpenSSL Corporation", "OpenSSL FIPS Provider").name == "C"
    assert classify("", "Botan", "Botan Cryptographic Module").name == "C++"
    assert classify("", "atsec corp.", "leancrypto (AVX2)").name == "C"
    assert classify("", "Intel", "Intel® Cryptography Primitives Library").name == "C"
    assert classify("", "Intel", "Intel Multi-Buffer Crypto for IPsec").name == "C"
    assert classify("", "PQShield Ltd.", "PQCryptoLib-Core").name == "C"
    assert classify("", "CryptoNext Security", "C-QSL (AVX2)").name == "C"


def test_hardware_and_firmware_without_evidence_are_not_applicable():
    result = classify(
        "", "STMicroelectronics", "Trusted Platform Module ST33KTPM2A", "hardware"
    )
    assert result.name == ""
    assert result.source == "not_applicable"
    # Upstream evidence still wins for firmware that uses a known library.
    assert classify(
        "", "Ciena", "Ciena Wavelogic 5e Encryption Modem WolfSSL", "firmware"
    ).name == "C"
    assert classify(
        "", "Cisco", "Linux Kernel FIPS Object Module (KFOM)", "firmware_hybrid"
    ).source == "not_applicable"


def test_unknown_software_stays_unknown():
    result = classify("", "Unknown Vendor", "Mystery Module", "software")
    assert result.name == ""
    assert result.source == "none"
