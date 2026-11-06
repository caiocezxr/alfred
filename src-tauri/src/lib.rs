mod briefing;
mod commands;
mod db;
mod ideas;
mod mood;
mod notes;
mod radar;
mod work;

use commands::AppState;
use std::sync::Mutex;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            let data_dir = app.path().app_data_dir()?;
            std::fs::create_dir_all(&data_dir)?;
            let (conn, open_error) = match db::open(&data_dir.join("personal-space.sqlite"), &data_dir.join("backups")) {
                Ok(c) => (Some(c), None),
                Err(e) => {
                    log::error!("banco: {e}");
                    (None, Some(e))
                }
            };
            app.manage(AppState { conn: Mutex::new(conn), open_error, data_dir });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                if cfg!(target_os = "macos") && window.label() == "main" {
                    api.prevent_close();
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::db_info,
            commands::backup_now,
            commands::setting_get,
            commands::setting_set,
            commands::tasks_list,
            commands::task_create,
            commands::task_update,
            commands::task_delete,
            commands::tasks_reorder,
            commands::habits_list,
            commands::habit_create,
            commands::habit_update,
            commands::habit_set_paused,
            commands::habit_archive,
            commands::checkins_range,
            commands::checkin_set,
            ideas::ideas_list,
            ideas::idea_create,
            ideas::idea_update,
            ideas::idea_set_answer,
            ideas::idea_set_next_test,
            ideas::idea_delete,
            ideas::idea_evidence_add,
            ideas::idea_evidence_delete,
            notes::notes_list,
            notes::note_get,
            notes::note_create,
            notes::note_save,
            notes::note_move,
            notes::note_duplicate,
            notes::note_set_archived,
            notes::note_trash,
            notes::note_restore,
            notes::note_purge,
            notes::notes_trash_empty,
            notes::notes_search,
            notes::note_asset_save,
            notes::note_asset_get,
            notes::note_export_markdown,
            radar::radar_fetch,
            radar::radar_sources_list,
            radar::radar_source_add,
            radar::radar_source_update,
            radar::radar_source_delete,
            radar::radar_source_report,
            radar::radar_items_list,
            radar::radar_items_upsert,
            radar::radar_translate,
            radar::radar_item_set,
            radar::radar_cleanup,
            radar::radar_keywords_list,
            radar::radar_keyword_save,
            radar::radar_keyword_delete,
            mood::day_get,
            mood::day_set,
            mood::days_range,
            briefing::briefing_today,
            briefing::briefing_begin,
            briefing::briefing_finish,
            briefing::briefing_fail,
            briefing::briefing_sources_list,
            briefing::briefing_source_update,
            briefing::briefing_fetch,
            briefing::briefing_market,
            briefing::briefing_feedback_set,
            briefing::briefing_feedback_remove,
            briefing::briefing_feedback_list,
            briefing::briefing_judge,
            briefing::briefing_codex_status,
            briefing::briefing_voices,
            briefing::briefing_tts,
            briefing::briefing_profile_get,
            briefing::briefing_profile_save,
            briefing::briefing_translate,
            briefing::briefing_taste_rank,
            briefing::briefing_rating_set,
            briefing::briefing_rating_list,
            briefing::briefing_rating_undo,
            work::work_load,
            work::work_timer_start,
            work::work_timer_stop,
            work::work_session_delete,
            work::work_snippet_save,
            work::work_snippet_delete,
            work::work_seen_touch,
            work::work_item_create,
            work::work_item_update,
            work::work_item_delete,
            work::work_item_move,
            work::work_item_return,
            work::work_item_resume,
            work::work_item_wait,
            work::work_item_followup,
            work::work_item_note,
            work::work_note_delete,
            work::work_item_snooze,
            work::work_item_focus,
            work::work_item_check,
            work::work_items_reorder,
            work::work_checklist_add,
            work::work_checklist_rename,
            work::work_checklist_remove,
            work::work_checklist_reorder,
            work::work_company_create,
            work::work_company_update,
            work::work_company_delete,
            work::work_settings_set,
            work::work_todo_create,
            work::work_todo_update,
            work::work_todo_done,
            work::work_todo_check,
            work::work_todo_delete,
            work::work_todo_convert,
            work::work_todos_import,
            work::work_attachment_save,
            work::work_attachment_get,
            work::work_attachment_delete,
            work::work_secret_add,
            work::work_secret_reveal,
            work::work_secret_delete,
            work::work_day_set,
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = event {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.show();
                    let _ = w.unminimize();
                    let _ = w.set_focus();
                }
            }
            #[cfg(not(target_os = "macos"))]
            let _ = (app, event);
        });
}
