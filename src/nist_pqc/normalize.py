"""Turn free-text CAVP operating environments into queryable fields.

Everything here is heuristic and deliberately conservative: unmatched values
keep an ``unknown`` family so they are easy to find and tune.
"""

from __future__ import annotations

import re

#: Ordered: the first matching pattern wins, so put Windows before Linux
#: (WSL strings) and iOS before macOS.
OS_RULES: list[tuple[str, str]] = [
    ("windows", r"\bwindows\b"),
    ("appliance", r"\b(powerstoreos|ontap|junos|pan-?os|fortios|ios-?xe|nx-?os|"
                  r"eosv?\d*|fxos|arubaos|comware|sonicos|ironware|extremexos|"
                  r"screenos|ftd|gaia|ilom|proharden|silvus|synology|dsm)\b"),
    ("simulator", r"\b(synopsys|vcs|questa|modelsim|simulation|simulator|"
                  r"emulator|qemu)\b"),
    ("ios", r"\b(iOS|iPadOS|tvOS|watchOS|visionOS)\b"),
    ("android", r"\bandroid\b"),
    ("macos", r"\b(mac ?os|os ?x|darwin)\b"),
    ("freebsd", r"\b(freebsd|netbsd|openbsd|dragonfly)\b"),
    ("solaris", r"\b(solaris|illumos|smartos)\b"),
    ("aix", r"\baix\b"),
    ("hpux", r"\bhp-?ux\b"),
    ("zos", r"\bz/os\b"),
    ("linux", r"\b(linux|ubuntu|debian|centos|fedora|suse|sles|rhel|red hat|"
              r"amazon linux|oracle linux|rocky|alma|alpine|photon|"
              r"opensuse|raspbian|yocto|wind river linux|alinux\d*|"
              r"almalinux|alibaba cloud linux|tencentos|kylin|uniontech|uos|"
              r"uniconos)\b"),
    ("rtos", r"\b(freertos|vxworks|zephyr|threadx|mbed|rtos|qnx|integrity|"
             r"embos|micrium|nuttx|azure rtos|green hills|trusty)\b"),
    ("hypervisor", r"\b(hyper-v|esxi|esx|xen|kvm|hypervisor)\b"),
    ("jvm", r"\b(java|jvm|openjdk)\b"),
    ("firmware", r"\b(u-boot|uefi|coreboot|bios|bootloader)\b"),
]

#: Values that mean "no operating system" rather than "we failed to parse".
NO_OS_RE = re.compile(
    r"^(n/?a|none|no os|bare[- ]metal|hardware|firmware|silicon|asic|fpga|"
    r"not applicable|-+)$",
    re.IGNORECASE,
)

CPU_VENDOR_RULES: list[tuple[str, str]] = [
    ("intel", r"\bintel\b"),
    ("amd", r"\b(amd|advanced micro devices|epyc|ryzen)\b"),
    ("xilinx", r"\bxilinx\b"),
    ("arm", r"\b(arm|armv\d|neoverse|cortex)\b"),
    ("aws", r"\b(amazon|aws|graviton)\b"),
    ("ampere", r"\bampere\b"),
    ("apple", r"\bapple\b"),
    ("qualcomm", r"\bqualcomm\b"),
    ("marvell", r"\b(marvell|cavium|octeon|thunderx)\b"),
    ("broadcom", r"\bbroadcom\b"),
    ("ibm", r"\b(ibm|power\d*|powerpc)\b"),
    ("nvidia", r"\bnvidia\b"),
    ("google", r"\bgoogle\b"),
    ("samsung", r"\bsamsung\b"),
    ("nxp", r"\b(nxp|freescale|i\.mx)\b"),
    ("microchip", r"\b(microchip|atmel)\b"),
    ("sifive", r"\bsifive\b"),
    ("infineon", r"\binfineon\b"),
    ("renesas", r"\brenesas\b"),
    ("stmicro", r"\bst ?micro\b"),
    ("texas-instruments", r"\btexas instruments\b"),
]

ARCH_RULES: list[tuple[str, str]] = [
    ("x86_64", r"\b(?:core(?:\s|\W){0,3}i[3579]|core ultra|pentium|celeron|atom)\b"),
    ("x86_64", r"\b(x86[_-]?64|amd64|x64|xeon|epyc|ryzen|core i\d|pentium|"
               r"celeron|atom|ice lake|sapphire rapids|skylake|haswell)\b"),
    ("arm64", r"\b(aarch64|arm64|armv8|armv9|graviton|ampere|neoverse|"
              r"cortex-a(5[3-9]|[6-9]\d|\d{3})|apple m\d|thunderx|"
              r"zynq|ultrascale|versal)\b"),
    ("arm32", r"\b(arm|armv7|cortex-a[5-9]|cortex-a1\d|cortex-m\d)\b"),
    ("ppc64", r"\b(ppc64|power8|power9|power10|powerpc)\b"),
    ("s390x", r"\b(s390x|s390)\b"),
    ("riscv64", r"\b(riscv|risc-v|sifive)\b"),
    ("mips", r"\bmips\b"),
    ("x86", r"\b(x86|ia-?32|i[3-6]86)\b"),
]


#: A runtime/library clause appended to an OS name, e.g. "Ubuntu 22.04 with
#: Java SE Runtime Environment" or "RHEL 9 with OpenSSL 3.0".
RUNTIME_CLAUSE_RE = re.compile(
    r"\s+with\s+(?:java|jvm|openjdk|graalvm|zulu|corretto|openssl|boringssl|"
    r"libressl|\.net|node\.?js|mozilla nss|wolfssl)\b.*$",
    re.IGNORECASE,
)


def _clean(text: str) -> str:
    text = (text or "").replace("\xa0", " ")
    return re.sub(r"\s+", " ", text).strip(" ,;")


def split_oe_name(oe_name: str) -> tuple[str, str]:
    """Fallback split of "Amazon Linux 2023 on EC2 bare metal on Graviton"."""
    parts = re.split(r"\s+on\s+", _clean(oe_name))
    if len(parts) == 1:
        return parts[0], ""
    if len(parts) == 2:
        return parts[0], parts[1]
    return parts[0], " on ".join(parts[1:])


def os_family_of(software: str, oe_name: str = "") -> str:
    text = f"{software} {oe_name}"
    if NO_OS_RE.match(_clean(software)):
        return "none"
    for family, pattern in OS_RULES:
        if re.search(pattern, text, re.IGNORECASE):
            return family
    return "none" if NO_OS_RE.match(_clean(oe_name)) else "unknown"


def split_os_version(os_name: str) -> tuple[str, str]:
    """Split "Red Hat Enterprise Linux 9.4 LTS" into product and version."""
    name = _clean(os_name)
    name = re.sub(r"\s*[\(\[]([^\)\]]*)[\)\]]\s*$", "", name)
    flavour = ""
    suffix = re.search(r"\s+(LTS|ESU|LTSC|GA|SP\d+)$", name, re.IGNORECASE)
    if suffix:
        flavour = suffix.group(1).upper()
        name = name[: suffix.start()]
    version = ""
    match = re.search(r"\s+v?(\d+(?:\.\d+)*)$", name)
    if match:
        version = match.group(1)
        name = name[: match.start()]
    if flavour:
        version = f"{version} {flavour}".strip()
    return _clean(name), version


def arch_of(*parts: str) -> str:
    text = " ".join(p for p in parts if p)
    for arch, pattern in ARCH_RULES:
        if re.search(pattern, text, re.IGNORECASE):
            return arch
    return "unknown"


def cpu_vendor_of(*parts: str) -> str:
    text = " ".join(p for p in parts if p)
    for vendor, pattern in CPU_VENDOR_RULES:
        if re.search(pattern, text, re.IGNORECASE):
            return vendor
    return ""


def normalize_oe(oe_name: str, dependencies: dict | None) -> dict[str, str]:
    """Build the flattened operating-environment record for one ``oe_id``."""
    dependencies = dependencies or {}

    def first(keys: tuple[str, ...]) -> dict:
        for key in keys:
            items = dependencies.get(key) or []
            if items:
                return items[0]
        return {}

    software_item = first(("software", "os", "operating system"))
    processor_item = first(("processor", "cpu", "hardware", "firmware", "module"))

    software = RUNTIME_CLAUSE_RE.sub("", _clean(software_item.get("value", "")))
    processor = _clean(processor_item.get("value", ""))
    fallback_software, fallback_processor = split_oe_name(oe_name)
    if not software and not dependencies:
        software = fallback_software
    if not processor:
        processor = fallback_processor

    os_name = _clean(re.split(r"\s+on\s+", software, maxsplit=1)[0]) if software else ""
    os_family = os_family_of(software, oe_name) if software else "none"
    if os_family == "none":
        os_name = ""
    os_product, os_version = split_os_version(os_name)

    cpu_family = _clean(processor_item.get("family", ""))
    cpu_manufacturer = _clean(processor_item.get("manufacturer", ""))
    cpu_series = _clean(processor_item.get("series", ""))
    arch = arch_of(cpu_family, cpu_series, processor, oe_name, software)
    cpu_vendor = cpu_vendor_of(cpu_manufacturer, processor, oe_name)

    return {
        "oe_name": _clean(oe_name),
        "software": software,
        "processor": processor,
        "cpu_family": cpu_family,
        "cpu_vendor": cpu_vendor,
        "cpu_series": cpu_series,
        "os_family": os_family,
        "os_name": os_name,
        "os_product": os_product,
        "os_version": os_version,
        "arch": arch,
        "target": f"{os_name} / {arch}" if os_name else arch,
    }


def target_label(os_name: str, arch: str) -> str:
    return f"{os_name} / {arch}" if os_name else arch
