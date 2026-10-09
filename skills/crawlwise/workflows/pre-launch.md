# Pre-launch SEO check

1. list_sites. crawl_site on the verified site.
2. Poll the crawl. get_crawl_issues and get_internal_link_suggestions.
3. Go/no-go: fail on priority cross-page defects (redirect loops, broken internal links). Empty suggestions are not a fail.
4. Orphans are not_measured if the crawl was capped — say that, do not guess.
