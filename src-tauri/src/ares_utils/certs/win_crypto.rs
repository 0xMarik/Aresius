#[cfg(target_os = "windows")]
#[allow(non_snake_case, non_camel_case_types)]
pub mod win_cert_store {
    use sha1::{Digest, Sha1};
    use std::ffi::c_void;
    use std::ptr;

    type HCERTSTORE = *mut c_void;
    type PCERT_CONTEXT = *const CERT_CONTEXT;

    #[repr(C)]
    struct CRYPTOAPI_BLOB {
        cbData: u32,
        pbData: *const u8,
    }

    #[repr(C)]
    struct CERT_INFO {
        _opaque: [u8; 0],
    }

    #[repr(C)]
    struct CERT_CONTEXT {
        dwCertEncodingType: u32,
        pbCertEncoded: *const u8,
        cbCertEncoded: u32,
        pCertInfo: *mut CERT_INFO,
        hCertStore: HCERTSTORE,
    }


    const X509_ASN_ENCODING: u32 = 0x00000001;
    const PKCS_7_ASN_ENCODING: u32 = 0x00010000;
    const CERT_ENCODING: u32 = X509_ASN_ENCODING | PKCS_7_ASN_ENCODING;

    const CERT_STORE_PROV_SYSTEM_W: usize = 10;
    const CERT_SYSTEM_STORE_CURRENT_USER: u32 = 0x00010000;
    const CERT_STORE_OPEN_EXISTING_FLAG: u32 = 0x00004000;

    const CERT_STORE_ADD_REPLACE_EXISTING: u32 = 3;
    const CERT_FIND_SHA1_HASH: u32 = 0x00010000;
    const CERT_FIND_SUBJECT_STR_W: u32 = 0x00080007;

    #[link(name = "crypt32")]
    extern "system" {
        fn CertOpenStore(
            lpszStoreProvider: usize,
            dwMsgAndCertEncodingType: u32,
            hCryptProv: usize,
            dwFlags: u32,
            pvPara: *const u16,
        ) -> HCERTSTORE;

        fn CertAddEncodedCertificateToStore(
            hCertStore: HCERTSTORE,
            dwCertEncodingType: u32,
            pbCertEncoded: *const u8,
            cbCertEncoded: u32,
            dwAddDisposition: u32,
            ppCertContext: *mut PCERT_CONTEXT,
        ) -> i32;

        fn CertFindCertificateInStore(
            hCertStore: HCERTSTORE,
            dwCertEncodingType: u32,
            dwFindFlags: u32,
            dwFindType: u32,
            pvFindPara: *const c_void,
            pPrevCertContext: PCERT_CONTEXT,
        ) -> PCERT_CONTEXT;

        fn CertDeleteCertificateFromStore(pCertContext: PCERT_CONTEXT) -> i32;

        fn CertFreeCertificateContext(pCertContext: PCERT_CONTEXT) -> i32;

        fn CertCloseStore(hCertStore: HCERTSTORE, dwFlags: u32) -> i32;
    }

    unsafe fn open_user_root_store() -> Result<HCERTSTORE, String> {
        let store_name: Vec<u16> = "Root\0".encode_utf16().collect();
        let h_store = CertOpenStore(
            CERT_STORE_PROV_SYSTEM_W,
            0,
            0,
            CERT_SYSTEM_STORE_CURRENT_USER | CERT_STORE_OPEN_EXISTING_FLAG,
            store_name.as_ptr(),
        );

        if h_store.is_null() {
            let err = std::io::Error::last_os_error();
            return Err(format!("Failed to open Windows User Root certificate store: {err}"));
        }
        Ok(h_store)
    }

    pub fn install_ca_to_user_root_store(der_bytes: &[u8]) -> Result<(), String> {
        unsafe {
            let h_store = open_user_root_store()?;
            let res = CertAddEncodedCertificateToStore(
                h_store,
                CERT_ENCODING,
                der_bytes.as_ptr(),
                der_bytes.len() as u32,
                CERT_STORE_ADD_REPLACE_EXISTING,
                ptr::null_mut(),
            );
            CertCloseStore(h_store, 0);

            if res == 0 {
                let err = std::io::Error::last_os_error();
                return Err(format!("Failed to add CA certificate to Windows Root store: {err}"));
            }
            Ok(())
        }
    }

    pub fn is_ca_in_user_root_store(der_bytes: &[u8]) -> bool {
        unsafe {
            let Ok(h_store) = open_user_root_store() else {
                return false;
            };

            let mut hasher = Sha1::new();
            hasher.update(der_bytes);
            let sha1_hash = hasher.finalize();

            let sha1_blob = CRYPTOAPI_BLOB {
                cbData: sha1_hash.len() as u32,
                pbData: sha1_hash.as_ptr(),
            };

            let p_cert = CertFindCertificateInStore(
                h_store,
                CERT_ENCODING,
                0,
                CERT_FIND_SHA1_HASH,
                &sha1_blob as *const _ as *const c_void,
                ptr::null(),
            );

            let found = !p_cert.is_null();
            if found {
                CertFreeCertificateContext(p_cert);
            }
            CertCloseStore(h_store, 0);
            found
        }
    }

    pub fn remove_ca_from_user_root_store(der_bytes: Option<&[u8]>) -> Result<(), String> {
        unsafe {
            let h_store = open_user_root_store()?;

            // 1. Delete by SHA-1 hash if provided
            if let Some(der) = der_bytes {
                let mut hasher = Sha1::new();
                hasher.update(der);
                let sha1_hash = hasher.finalize();

                let sha1_blob = CRYPTOAPI_BLOB {
                    cbData: sha1_hash.len() as u32,
                    pbData: sha1_hash.as_ptr(),
                };

                loop {
                    let p_cert = CertFindCertificateInStore(
                        h_store,
                        CERT_ENCODING,
                        0,
                        CERT_FIND_SHA1_HASH,
                        &sha1_blob as *const _ as *const c_void,
                        ptr::null(),
                    );
                    if p_cert.is_null() {
                        break;
                    }
                    CertDeleteCertificateFromStore(p_cert);
                }
            }

            // 2. Also clean up any lingering certificates matching "Aresius CA"
            let subject_name: Vec<u16> = "Aresius CA\0".encode_utf16().collect();
            loop {
                let p_cert = CertFindCertificateInStore(
                    h_store,
                    CERT_ENCODING,
                    0,
                    CERT_FIND_SUBJECT_STR_W,
                    subject_name.as_ptr() as *const c_void,
                    ptr::null(),
                );
                if p_cert.is_null() {
                    break;
                }
                CertDeleteCertificateFromStore(p_cert);
            }

            CertCloseStore(h_store, 0);
            Ok(())
        }
    }
}
