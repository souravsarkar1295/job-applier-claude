# Job board prototype

Clickable prototype of the finder and tracker, built on a snapshot of the Google Sheet.

`build_data.py SNAPSHOT.json data.json` normalises dates and computes the score, CV suggestion, work-rights flag, job board (ATS) and company coverage. The page is `template.html` with `__DATA__` replaced by the contents of `data.json`.

The snapshot and `data.json` contain personal job-search data and are never committed.
