use napi::bindgen_prelude::*;
use ignore::WalkBuilder;
use std::sync::{Arc, Mutex};
use std::fs;
use std::path::Path;

#[napi(object)]
#[derive(Clone)]
pub struct GrepResult {
  pub file_path: String,
  pub line_number: u32,
  pub content: String,
}

#[napi]
pub async fn parallel_grep(
  directory: String,
  query: String,
) -> Result<Vec<GrepResult>> {
  let results = Arc::new(Mutex::new(Vec::new()));
  let query = Arc::new(query);

  let walker = WalkBuilder::new(&directory)
    .hidden(false)
    .ignore(true)
    .git_ignore(true)
    .build_parallel();

  walker.run(|| {
    let results_clone = Arc::clone(&results);
    let query_clone = Arc::clone(&query);

    Box::new(move |result| {
      if let Ok(entry) = result {
        let path = entry.path();
        if path.is_file() {
          if let Ok(content) = fs::read_to_string(path) {
            let mut local_matches = Vec::new();
            for (i, line) in content.lines().enumerate() {
              if line.contains(query_clone.as_str()) {
                local_matches.push(GrepResult {
                  file_path: path.to_string_lossy().to_string(),
                  line_number: (i + 1) as u32,
                  content: line.to_string(),
                });
              }
            }
            if !local_matches.is_empty() {
              let mut global_results = results_clone.lock().unwrap();
              global_results.extend(local_matches);
            }
          }
        }
      }
      ignore::WalkState::Continue
    })
  });

  let final_results = results.lock().unwrap().clone();
  Ok(final_results)
}
