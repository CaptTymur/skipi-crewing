# ЗАМЕР ПО КОДУ — вторая ступень входа: адрес и форма (No.930, стадия 2)

Замерено 2026-11-06T01:55:09Z. Слой: **НАЙДЕНО В КЛИЕНТСКОМ КОДЕ (чтение названного SHA). Не «проверено в работе».**

Базис: `f145c6017eaea3804a5429e5aa428b6fb0ece6d9` — живой main ПО МОЕМУ `ls-remote`, снятому ДО стадии; это мой REPORT, а не заверенный гейтом факт: сетевых действий не делают ни стадия, ни координатор. В стадии базис проверен ЛОКАЛЬНО — объект есть в репозитории, и субъект замера байт-в-байт равен `git show <базис>:<файл>`. В наборе замера файлов: 25 (весь `src-tauri/src`, фронтенд `dist/index.html`, конфигурация сборки).

Суммы субъектов на момент замера:

- `src-tauri/src/native_account.rs` — `513c79a4f85f7a64de6b581575f8d0f9c2930966ef6c7bfec5e784f172df3f7d`
- `src-tauri/src/native_lifecycle.rs` — `9b7d54f7788612796d216141fc1fee7c39716fc2501143f1fd152e21d32e29bb`
- `src-tauri/src/native_local_commit.rs` — `d9d54d13f839231812c5397592c111f3dfb43bb180cb4f68a0aa78eeadea20c4`

## СПИСОК 1 — ЧТО ПРОВЕРЯЕТ И ДЕЛАЕТ КОД

**Q1. Полный URL второй ступени.** хост-литерал(ы): `assistant.skipi.app`; путевые литералы: `/api/app`

Места путевых литералов: `src-tauri/src/native_account.rs:488`, `src-tauri/src/native_account.rs:497`, `src-tauri/src/native_account.rs:504`, `src-tauri/src/native_account.rs:763`, `src-tauri/src/native_account.rs:778`, `src-tauri/src/native_account.rs:780`, `src-tauri/src/native_account.rs:783`, `src-tauri/src/native_lifecycle.rs:90`

**Q2. Поле, разбираемое как идентификатор рабочего места.** `connection.crewing_id` (String, в `Connection`, src-tauri/src/native_account.rs:29); `connection.organization_id` (Option<String>, в `Connection`, src-tauri/src/native_account.rs:29, аттрибуты: #[serde(deserialize_with = "required_nullable")])

**Q3. Плоская форма или вложенная.** ВЛОЖЕННУЮ. Десериализатор требует поля-структуры: `connection: Connection`, `entitlement: Entitlement`. `#[serde(flatten)]` в наборе замера: 2 вхождений; `#[serde(alias` : 0. Плоские семь ключей в такую структуру НЕ укладываются — это свойство типа, а не строгости проверок.

**Q4. Откуда берётся префикс.** константа `ACCOUNT_ORIGIN` — `src-tauri/src/native_account.rs:7`, `src-tauri/src/native_account.rs:382`, `src-tauri/src/native_account.rs:387`, `src-tauri/src/native_account.rs:518` (+1 ещё); строковые константы адреса: `src-tauri/src/api.rs:6` pub(crate) const PRIMARY_API: &str = "https://api.skipi.app";, `src-tauri/src/api.rs:7` pub(crate) const RU_API: &str = "https://api-ru.skipi.app";, `src-tauri/src/native_account.rs:7` pub(crate) const ACCOUNT_ORIGIN: &str = "https://assistant.skipi.app";; перекрытие средой: `env!/option_env!` 6 вхождений, `env::var` 9 вхождений

### Форма ответа, как её ТРЕБУЕТ десериализатор

- **`BootstrapResponse`** (`src-tauri/src/native_account.rs:22`), контейнерные аттрибуты: `#[derive(Clone, Deserialize)]`
  - `account_id: String`
  - `connection: Connection`
  - `entitlement: Entitlement`
  вложено в поле `connection`:
    - **`Connection`** (`src-tauri/src/native_account.rs:29`), контейнерные аттрибуты: `#[derive(Clone, Deserialize, Serialize)]`
      - `server_url: String`
      - `crewing_id: String`
      - `organization_id: Option<String>` — Option `#[serde(deserialize_with = "required_nullable")]`
      - `bearer_token: String`
      - `scopes: Vec<String>`
      - `expires_at: String`
  вложено в поле `entitlement`:
    - **`Entitlement`** (`src-tauri/src/native_account.rs:40`), контейнерные аттрибуты: `#[derive(Clone, Deserialize, Serialize)]`
      - `source: String`
      - `expires_at: Option<String>` — Option `#[serde(deserialize_with = "required_nullable")]`

### Ожидания НОЛЯ и их положительные контроли

| игла | вхождений | контроль | вердикт |
|---|---|---|---|
| `/api/internal` | 0 | `prefix_api_app` = 8 | ноль ПОДТВЕРЖДЁН контролем |
| `workspace_id` | 0 | `field_crewing_id` = 214 | ноль ПОДТВЕРЖДЁН контролем |
| `device_id` | 0 | `field_crewing_id` = 214 | ноль ПОДТВЕРЖДЁН контролем |

Ноль без живого контроля записью не является: прибор в этом случае отказывает (rc 3), а не докладывает ноль. Калибровка трёх арм — `calibration-930-s7.md`.

## СПИСОК 2 — ЧТО ПОДТВЕРДИЛ СТЕНД

**ПУСТО, и это не пропуск.** Стенда в этой стадии нет, живых запросов нет ни одного: разрешение владельца на один немутирующий запрос израсходовано 05.11, повтор требует нового слова. Стенд 04.11 в этот список не переносится — карточка измерила, что он был **зеркалом**: заглушка отвечала В ФОРМЕ КЛИЕНТА, поэтому девять проверок `BootstrapResponse::validate` ни разу не встречались с настоящим ответом сервера.

Следствие для чтения этой записи: всё выше — **свойства клиентского кода**. Ни одна строка не утверждает, что боевой сервер отвечает так или иначе; расхождение с сервером (№956 BLOCKER) закрывается решением владельца об адресе, а не этим замером.

