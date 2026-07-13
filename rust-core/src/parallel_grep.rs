use napi::bindgen_prelude::*;
use ignore::WalkBuilder;
use std::sync::{Arc, Mutex};
use std::fs;

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

#[cfg(test)]
mod tests {
  use super::*;
  use std::fs;
  use std::os::unix::fs::symlink;
  use std::time::Instant;
  use tempfile::TempDir;

  /// Helper to run the async parallel_grep in a sync test context
  fn run_grep(dir: &std::path::Path, query: &str) -> Vec<GrepResult> {
    let rt = tokio::runtime::Runtime::new().unwrap();
    rt.block_on(parallel_grep(
      dir.to_string_lossy().to_string(),
      query.to_string(),
    ))
    .unwrap()
  }

  // ── Basic functionality ──────────────────────────────────────────────

  #[test]
  fn test_empty_directory() {
    let dir = TempDir::new().unwrap();
    let results = run_grep(dir.path(), "test");
    assert!(results.is_empty(), "Empty directory should produce zero results");
  }

  #[test]
  fn test_no_matches() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("file.txt"), "hello world\nfoo bar").unwrap();
    let results = run_grep(dir.path(), "xyz_nonexistent");
    assert!(results.is_empty(), "Should find zero matches for non-existent pattern");
  }

  #[test]
  fn test_single_match() {
    let dir = TempDir::new().unwrap();
    fs::write(
      dir.path().join("test.txt"),
      "hello world\ntest line\nfoo",
    )
    .unwrap();
    let results = run_grep(dir.path(), "test");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].line_number, 2);
    assert_eq!(results[0].content, "test line");
    assert!(results[0].file_path.ends_with("test.txt"));
  }

  #[test]
  fn test_multiple_matches_single_file() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("a.txt"), "test\nfoo\ntest again").unwrap();
    let results = run_grep(dir.path(), "test");
    assert_eq!(results.len(), 2);
    // Both matches should reference the same file
    assert!(results.iter().all(|r| r.file_path.ends_with("a.txt")));
    assert_eq!(results[0].line_number, 1);
    assert_eq!(results[1].line_number, 3);
  }

  #[test]
  fn test_multiple_matches_across_files() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("a.txt"), "test\nfoo\ntest").unwrap();
    fs::write(dir.path().join("b.txt"), "bar\ntest").unwrap();
    fs::write(dir.path().join("c.txt"), "no match here").unwrap();
    let results = run_grep(dir.path(), "test");
    assert_eq!(results.len(), 3, "Should find 3 matches across 2 files");
  }

  // ── Edge cases ───────────────────────────────────────────────────────

  #[test]
  fn test_empty_query_matches_all_lines() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("file.txt"), "line1\nline2\nline3").unwrap();
    let results = run_grep(dir.path(), "");
    // Empty string matches every line (str::contains("") is always true)
    assert_eq!(results.len(), 3);
  }

  #[test]
  fn test_empty_file() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("empty.txt"), "").unwrap();
    let results = run_grep(dir.path(), "test");
    assert!(results.is_empty(), "Empty file should have no matches");
  }

  #[test]
  fn test_file_with_no_trailing_newline() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("no_nl.txt"), "test line no newline").unwrap();
    let results = run_grep(dir.path(), "test");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].content, "test line no newline");
  }

  #[test]
  fn test_special_characters_in_query() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("special.txt"), "price is $10.00\nfoo [bar]").unwrap();
    // Since we use .contains() not regex, special chars are literal
    let results = run_grep(dir.path(), "$10.00");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].content, "price is $10.00");
  }

  #[test]
  fn test_unicode_content() {
    let dir = TempDir::new().unwrap();
    fs::write(
      dir.path().join("unicode.txt"),
      "日本語テスト\nhello\ncafé résumé",
    )
    .unwrap();
    let results = run_grep(dir.path(), "日本語");
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].line_number, 1);
  }

  // ── Binary files ─────────────────────────────────────────────────────

  #[test]
  fn test_binary_files_skipped() {
    let dir = TempDir::new().unwrap();
    // Binary file with null bytes - fs::read_to_string will fail on this
    let binary_content: Vec<u8> = (0..255).collect();
    fs::write(dir.path().join("binary.bin"), &binary_content).unwrap();
    // Also add a text file to verify normal operation
    fs::write(dir.path().join("text.txt"), "test match").unwrap();
    let results = run_grep(dir.path(), "test");
    assert_eq!(results.len(), 1, "Only text file should match, binary should be skipped");
    assert!(results[0].file_path.ends_with("text.txt"));
  }

  #[test]
  fn test_binary_with_embedded_text() {
    let dir = TempDir::new().unwrap();
    // Null bytes surrounding text - still invalid UTF-8 due to certain byte sequences
    let mut content = vec![0u8, 1, 2, 3];
    content.extend_from_slice(b"embedded test");
    content.extend_from_slice(&[0, 254, 255]);
    fs::write(dir.path().join("mixed.bin"), &content).unwrap();
    let results = run_grep(dir.path(), "test");
    // Should be skipped because fs::read_to_string fails on invalid UTF-8
    assert!(
      results.is_empty(),
      "Binary file with embedded text should be skipped (invalid UTF-8)"
    );
  }

  #[test]
  fn test_valid_utf8_with_high_bytes() {
    let dir = TempDir::new().unwrap();
    // Valid UTF-8 that contains multi-byte characters but no null bytes
    fs::write(
      dir.path().join("valid_utf8.txt"),
      "test with émojis: ñ ü ö",
    )
    .unwrap();
    let results = run_grep(dir.path(), "test");
    assert_eq!(results.len(), 1, "Valid UTF-8 should be searchable");
  }

  // ── Directory structure ───────────────────────────────────────────────

  #[test]
  fn test_nested_subdirectories() {
    let dir = TempDir::new().unwrap();
    let nested = dir.path().join("a").join("b").join("c");
    fs::create_dir_all(&nested).unwrap();
    fs::write(nested.join("deep.txt"), "deep test match").unwrap();
    let results = run_grep(dir.path(), "test");
    assert_eq!(results.len(), 1);
    assert!(results[0].file_path.contains("deep.txt"));
  }

  #[test]
  fn test_symlink_to_file() {
    let dir = TempDir::new().unwrap();
    let target = dir.path().join("target.txt");
    let link = dir.path().join("link.txt");
    fs::write(&target, "test in target").unwrap();
    symlink(&target, &link).unwrap();
    let results = run_grep(dir.path(), "test");
    // Symlinks may or may not be followed depending on ignore crate behavior
    // At minimum the target file should be found
    assert!(results.len() >= 1, "Should find at least the target file");
  }

  #[test]
  fn test_symlink_to_directory() {
    let dir = TempDir::new().unwrap();
    let sub = dir.path().join("subdir");
    fs::create_dir(&sub).unwrap();
    fs::write(sub.join("file.txt"), "test content").unwrap();
    let link = dir.path().join("link_to_sub");
    symlink(&sub, &link).unwrap();
    let results = run_grep(dir.path(), "test");
    // The subdir's file should be found
    assert!(results.len() >= 1);
  }

  #[test]
  fn test_hidden_files_included() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join(".hidden"), "test hidden").unwrap();
    fs::write(dir.path().join("visible.txt"), "test visible").unwrap();
    let results = run_grep(dir.path(), "test");
    // hidden(false) in WalkBuilder means hidden files ARE included
    assert_eq!(results.len(), 2, "Both hidden and visible files should be searched");
  }

  // ── Gitignore handling ────────────────────────────────────────────────

  #[test]
  fn test_gitignore_respected() {
    // Use a temp dir outside the current git repo to avoid interference
    let dir = TempDir::new().unwrap();
    let dir_path = dir.path();

    // Initialize a git repo first
    std::process::Command::new("git")
      .args(["init"])
      .current_dir(dir_path)
      .output()
      .expect("git init failed");

    // Configure git user for the temp repo (avoids warnings)
    std::process::Command::new("git")
      .args(["config", "user.email", "test@test.com"])
      .current_dir(dir_path)
      .output()
      .ok();
    std::process::Command::new("git")
      .args(["config", "user.name", "Test"])
      .current_dir(dir_path)
      .output()
      .ok();

    // Create a .gitignore that ignores *.log files
    fs::write(dir_path.join(".gitignore"), "*.log\n").unwrap();
    fs::write(dir_path.join("test.log"), "test in log").unwrap();
    fs::write(dir_path.join("test.txt"), "test in txt").unwrap();

    let results = run_grep(dir_path, "test");
    // With git_ignore(true), .log files should be excluded
    assert_eq!(
      results.len(),
      1,
      "Only .txt file should match, .log should be gitignored. Got: {:?}",
      results.iter().map(|r| &r.file_path).collect::<Vec<_>>()
    );
    assert!(results[0].file_path.ends_with("test.txt"));
  }

  // ── Line numbering ───────────────────────────────────────────────────

  #[test]
  fn test_line_numbers_are_correct() {
    let dir = TempDir::new().unwrap();
    fs::write(
      dir.path().join("numbered.txt"),
      "line1\nline2\nmatch3\nline4\nmatch5\nline6",
    )
    .unwrap();
    let results = run_grep(dir.path(), "match");
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].line_number, 3);
    assert_eq!(results[1].line_number, 5);
  }

  // ── Error handling ───────────────────────────────────────────────────

  #[test]
  fn test_nonexistent_directory() {
    let results = run_grep(std::path::Path::new("/nonexistent_dir_12345"), "test");
    // Should return empty results, not panic
    assert!(results.is_empty());
  }

  // ── Content preservation ─────────────────────────────────────────────

  #[test]
  fn test_content_preserves_whitespace() {
    let dir = TempDir::new().unwrap();
    fs::write(
      dir.path().join("ws.txt"),
      "  indented test  \n\ttabbed test\t",
    )
    .unwrap();
    let results = run_grep(dir.path(), "test");
    assert_eq!(results.len(), 2);
    assert_eq!(results[0].content, "  indented test  ");
    assert_eq!(results[1].content, "\ttabbed test\t");
  }

  #[test]
  fn test_content_is_exact_line() {
    let dir = TempDir::new().unwrap();
    fs::write(dir.path().join("exact.txt"), "prefix_test_suffix").unwrap();
    let results = run_grep(dir.path(), "test");
    assert_eq!(results[0].content, "prefix_test_suffix");
  }

  // ── Many files (simulates real workload) ─────────────────────────────

  #[test]
  fn test_many_small_files() {
    let dir = TempDir::new().unwrap();
    for i in 0..100 {
      let content = if i % 3 == 0 {
        format!("file {} with match", i)
      } else {
        format!("file {} without", i)
      };
      fs::write(dir.path().join(format!("file_{:04}.txt", i)), content).unwrap();
    }
    let results = run_grep(dir.path(), "match");
    // Files 0, 3, 6, 9, ..., 99 = 34 files match
    let expected = (0..100).filter(|i| i % 3 == 0).count();
    assert_eq!(results.len(), expected);
  }

  // ── Performance benchmarks ───────────────────────────────────────────

  #[test]
  fn test_performance_many_files() {
    let dir = TempDir::new().unwrap();
    // Create 500 files with 50 lines each
    for i in 0..500 {
      let content = "no match here\n".repeat(49) + "test match line\n";
      fs::write(dir.path().join(format!("perf_{:04}.txt", i)), content).unwrap();
    }

    let start = Instant::now();
    let results = run_grep(dir.path(), "test");
    let elapsed = start.elapsed();

    assert_eq!(results.len(), 500, "Each file should have exactly one match");
    println!("Performance test: 500 files searched in {:?}", elapsed);
    // Sanity check: should complete in reasonable time (< 10 seconds on any machine)
    assert!(
      elapsed.as_secs() < 10,
      "Search should complete within 10 seconds, took {:?}",
      elapsed
    );
  }

  #[test]
  fn test_parallel_vs_serial_timing() {
    let dir = TempDir::new().unwrap();
    // Create enough files to benefit from parallelism
    for i in 0..200 {
      let content = "some text\n".repeat(50) + "target line here\n";
      fs::write(dir.path().join(format!("cmp_{:04}.txt", i)), content).unwrap();
    }

    // Parallel execution
    let start = Instant::now();
    let parallel_results = run_grep(dir.path(), "target");
    let parallel_time = start.elapsed();

    // Serial execution (manual walk)
    let start = Instant::now();
    let mut serial_results = Vec::new();
    let query = "target";
    for entry in WalkBuilder::new(dir.path()).hidden(false).build().flatten() {
      if entry.path().is_file() {
        if let Ok(content) = fs::read_to_string(entry.path()) {
          for (i, line) in content.lines().enumerate() {
            if line.contains(query) {
              serial_results.push(GrepResult {
                file_path: entry.path().to_string_lossy().to_string(),
                line_number: (i + 1) as u32,
                content: line.to_string(),
              });
            }
          }
        }
      }
    }
    let serial_time = start.elapsed();

    // Results should match in count
    assert_eq!(
      parallel_results.len(),
      serial_results.len(),
      "Parallel and serial should find the same number of matches"
    );

    println!("Parallel: {:?}, Serial: {:?}", parallel_time, serial_time);
    println!(
      "Speedup: {:.2}x",
      serial_time.as_secs_f64() / parallel_time.as_secs_f64()
    );
    // Note: We don't assert parallel is faster because on small datasets
    // the thread pool overhead can dominate. This is informational.
  }

  // ── Case sensitivity ─────────────────────────────────────────────────

  #[test]
  fn test_search_is_case_sensitive() {
    let dir = TempDir::new().unwrap();
    fs::write(
      dir.path().join("case.txt"),
      "Test with capital\ntest with lowercase\nTEST ALL CAPS",
    )
    .unwrap();
    let results = run_grep(dir.path(), "test");
    // .contains() is case-sensitive, only lowercase "test" matches
    assert_eq!(results.len(), 1);
    assert_eq!(results[0].line_number, 2);
    assert_eq!(results[0].content, "test with lowercase");
  }

  // ── Large lines ──────────────────────────────────────────────────────

  #[test]
  fn test_very_long_line() {
    let dir = TempDir::new().unwrap();
    let long_line = "a".repeat(100_000) + "MATCH" + &"b".repeat(100_000);
    fs::write(dir.path().join("long.txt"), long_line).unwrap();
    let results = run_grep(dir.path(), "MATCH");
    assert_eq!(results.len(), 1);
    assert!(results[0].content.contains("MATCH"));
  }
}
