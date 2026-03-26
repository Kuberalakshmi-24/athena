# Benchmark Analysis

This file captures the latest backend API benchmark results.
Source run: `backend/tests/performance_benchmark.py`

## Latency Table

| Action | Avg (ms) | P95 (ms) |
|---|---:|---:|
| health | 0.25 | 0.26 |
| clear_chat | 0.99 | 1.08 |
| teach_topic_stream | 1.00 | 1.12 |
| topic_quiz_stream | 1.07 | 1.11 |
| chat_history | 1.35 | 1.55 |
| save_user_subject | 1.62 | 1.80 |
| learning_path | 1.65 | 1.76 |
| final_test_stream | 1.91 | 2.05 |
| module_quiz_stream | 1.97 | 2.30 |
| dashboard | 3.33 | 3.51 |
| query_stream | 8.45 | 8.67 |
| update_level | 9.44 | 9.80 |
| query | 16.04 | 16.27 |

## Analysis Chart

```text
Performance Chart (avg latency)

query                        | ######################################## 16.04 ms
update_level                 | #######################                  9.44 ms
query_stream                 | #####################                    8.45 ms
dashboard                    | ########                                 3.33 ms
module_quiz_stream           | ####                                     1.97 ms
final_test_stream            | ####                                     1.91 ms
learning_path                | ####                                     1.65 ms
save_user_subject            | ####                                     1.62 ms
chat_history                 | ###                                      1.35 ms
topic_quiz_stream            | ##                                       1.07 ms
teach_topic_stream           | ##                                       1.00 ms
clear_chat                   | ##                                       0.99 ms
health                       | #                                        0.25 ms
```
