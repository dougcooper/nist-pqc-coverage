from nist_pqc.upstream import classify


def test_classifies_named_libraries():
    assert classify("Amazon Web Services, Inc", "AWS-LC 3 Cryptographic Module (static)") == "AWS-LC"
    assert classify("Red Hat, Inc.", "Red Hat Enterprise Linux 9 gnutls") == "GnuTLS"
    assert classify("SAP SE", "SAP SE Garden Linux 1877 Libgcrypt Cryptographic Module") == "Libgcrypt"
    assert classify("Ciena Corporation", "Ciena Wavelogic 6e Encryption Modem WolfSSL") == "wolfSSL"
    assert classify("Apple Inc.", "Apple corecrypto Module OS 26 [Apple silicon, User]") == "corecrypto"


def test_leaves_generic_names_unclassified():
    assert classify("Microchip Technology Inc", "Embedded Controller - Crypto Module 3") == ""
    assert classify("", "") == ""
