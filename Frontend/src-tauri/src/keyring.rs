// API keys live in Windows Credential Manager (DPAPI-backed), never on disk.
// Service name "pico"; the account name is the provider id, so the Python
// brain reads the same entry with keyring.get_password("pico", "gemini").
//
// load_key exists because the UI contract asks for it (round-tripping a saved
// key to verify it end-to-end); the Settings UI deliberately never displays a
// loaded key — it only checks key_present.

use keyring::Entry;

const SERVICE: &str = "pico";

/// Providers Pico may store. Anything else is refused.
pub const PROVIDERS: &[&str] = &["gemini", "claude", "openai", "ollama"];

fn entry(provider: &str) -> Result<Entry, String> {
    if !PROVIDERS.contains(&provider) {
        return Err(format!("unknown provider {provider}"));
    }
    Entry::new(SERVICE, provider).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn save_key(provider: String, key: String) -> Result<(), String> {
    let entry = entry(&provider)?;
    if key.is_empty() {
        return delete_key(provider);
    }
    entry.set_password(&key).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn load_key(provider: String) -> Result<Option<String>, String> {
    let entry = entry(&provider)?;
    match entry.get_password() {
        Ok(v) if !v.is_empty() => Ok(Some(v)),
        Ok(_) | Err(keyring::Error::NoEntry) => Ok(None),
        Err(e) => Err(e.to_string()),
    }
}

#[tauri::command]
pub fn delete_key(provider: String) -> Result<(), String> {
    let entry = entry(&provider)?;
    match entry.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(e) => Err(e.to_string()),
    }
}

/// Cheap "is a key saved?" for badges — never returns the secret itself.
#[tauri::command]
pub fn key_present(provider: String) -> bool {
    load_key(provider).ok().flatten().is_some()
}
