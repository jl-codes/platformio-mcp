# Embedded Systems Security Best Practices

As embedded systems and IoT devices become increasingly connected to networks and critical infrastructure, they present a lucrative target for cyberattacks. Securing these systems requires a comprehensive **"Secure by Design"** approach that addresses vulnerabilities across hardware, firmware, network communications, and the entire product lifecycle. 

This reference aligns with current industry standards (NIST IR 8259) and the latest regulatory mandates, such as the **EU Cyber Resilience Act (CRA)** and **UK PSTI**.

## 1. Hardware Security & Root of Trust (RoT)
Software security is only as strong as the hardware it runs on. A robust embedded system anchors its security in immutable hardware primitives.

* **Hardware Root of Trust:** Utilize a dedicated Secure Element (SE), Hardware Security Module (HSM), or Trusted Platform Module (TPM) to execute cryptographic operations and securely store keys. Secrets should never be stored in plaintext in standard flash memory.
* **Trusted Execution Environments (TEE):** Leverage architectures like ARM TrustZone or RISC-V PMP to physically and logically isolate secure processes (e.g., key management, authentication) from the rich operating system.
* **Physically Unclonable Functions (PUF):** Use PUFs to generate unique, unclonable cryptographic keys derived from microscopic manufacturing variations in the silicon, ensuring keys are never statically stored.
* **Disable Debug Interfaces:** In production builds, permanently disable or cryptographically lock hardware debugging interfaces (JTAG, SWD, UART) to prevent attackers from dumping memory or extracting firmware.
* **Anti-Tamper Mechanisms:** Implement physical security measures such as secure enclosures, tamper meshes, and battery-backed memory that zeroize cryptographic keys if the device enclosure is breached.

## 2. Secure Boot & Firmware Updates
A device that cannot be securely booted or updated is fundamentally insecure.

* **Secure Boot (Chain of Trust):** Implement cryptographic verification of the firmware before execution. The immutable boot ROM must verify the bootloader's digital signature, which in turn verifies the OS/RTOS, ensuring no malicious code is executed.
* **Secure Over-The-Air (OTA) Updates:**
  * **Sign and Encrypt:** All OTA updates must be cryptographically signed by the manufacturer and verified by the device before installation.
  * **A/B Partitioning (Dual-Bank Flash):** Maintain a known-good firmware image in a secondary memory bank. If an update fails, loses power, or crashes, the system automatically rolls back, preventing "bricked" devices.
  * **Anti-Rollback Protection:** Use hardware monotonic counters (e.g., eFuses) to prevent attackers from downgrading the device to an older, vulnerable firmware version.

## 3. Firmware & Software Security
Defensive software architectures prevent attackers from exploiting vulnerabilities to gain control of the device.

* **Memory Safety & Secure Coding:** Buffer overflows remain a primary attack vector. Adhere to strict coding standards like MISRA C/C++ or CERT C. Enable compiler protections (stack canaries, ASLR, DEP/NX) where the architecture supports them.
* **Memory Protection & Isolation:** Follow the principle of least privilege. Ensure tasks within your RTOS only have access to the memory and peripherals explicitly required. Use a Memory Protection Unit (MPU) to sandbox untrusted code.
* **Eliminate Default Credentials:** Never ship devices with default or hardcoded passwords (e.g., `admin/admin`). Require unique, per-device passwords generated during manufacturing, or use device-specific certificates.
* **Input Validation:** Treat all inputs—whether from a network socket, a sensor interface (I2C/SPI), or UART—as untrusted. Validate length, bounds, and format before processing to prevent injection attacks.

## 4. Cryptography & Network Security
Ensure data confidentiality and integrity both locally and across networks.

* **Standardized Cryptography:** Never "roll your own crypto." Use vetted, industry-standard algorithms (e.g., AES-256, ECC, RSA) and established libraries (like Mbed TLS, wolfSSL). Utilize hardware crypto-accelerators to reduce CPU overhead.
* **True Random Number Generators (TRNG):** Ensure your microcontroller utilizes a hardware-based TRNG to seed cryptographic functions, preventing predictable key generation.
* **Data in Transit:** Enforce strict Transport Layer Security (TLS 1.3 or DTLS 1.3) for all network communications. Employ mutual authentication (mTLS) to verify both the device and the server.
* **Data at Rest:** Encrypt local storage (NVM/Flash) to protect sensitive user data, PII, and configuration files.

## 5. Lifecycle Management & Regulatory Compliance
Global regulations are rapidly shifting from voluntary guidelines to strict legal mandates. Integrating security into your lifecycle is now a legal requirement.

* **Software Bill of Materials (SBOM):** Maintain a machine-readable inventory of all proprietary and open-source software dependencies (using standards like SPDX or CycloneDX). 
* **Continuous Vulnerability Monitoring:** Cross-reference your SBOM against the CISA Known Exploited Vulnerabilities (KEV) catalog and CVE databases to detect newly discovered flaws.
* **EU Cyber Resilience Act (CRA):** For devices sold in the EU, the CRA legally mandates "Secure by Design" architectures, strict vulnerability tracking, mandatory 24-hour reporting of actively exploited vulnerabilities (taking effect late 2026), and guaranteed security updates for the product's defined lifespan.
* **Secure Decommissioning:** Provide a verifiable "factory reset" mechanism to securely wipe all personal data and cryptographic keys when the device is retired or resold.