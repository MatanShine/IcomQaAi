import requests
from bs4 import BeautifulSoup
from urllib.parse import urlparse
import json
import time

BASE_URL = "https://support.zebracrm.com"

def get_category_urls():
    """Grab every /category/.../ link from the homepage navigation."""
    resp = requests.get(BASE_URL)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    cats = set()
    for a in soup.select("a[href^='" + BASE_URL + "/category/']"):
        href = a["href"].rstrip("/")
        cats.add(href + "/")
    return list(cats)

def is_article_url(href: str):
    """
    Returns True if href is a BASE_URL URL whose path is exactly one slug,
    e.g. https://support.zebracrm.com/reset-api-key/
    """
    if not href.startswith(BASE_URL):
        return False
    path = urlparse(href).path
    parts = [p for p in path.split("/") if p]
    return len(parts) == 1

def get_all_article_urls_for_category(cat_url: str):
    """Page through /page/2/, /page/3/, … until no new article URLs are found."""
    seen = set()
    page = 1

    while True:
        if page == 1:
            url = cat_url
        else:
            url = cat_url + f"page/{page}/"

        resp = requests.get(url)
        if resp.status_code == 404:
            break
        resp.raise_for_status()
        soup = BeautifulSoup(resp.text, "html.parser")

        # find all links on this page that look like an article
        links = set(
            a["href"].rstrip("/") + "/"
            for a in soup.find_all("a", href=True)
            if is_article_url(a["href"])
        )

        new = links - seen
        if not new:
            break

        print(f"  [{cat_url.split('/')[-2]}] found {len(new)} on page {page}")
        seen |= new
        page += 1
        time.sleep(0.3)

    return list(seen)

def scrape_article(url: str):
    """Fetches a Q&A page and pulls out the question & answer, auto-detecting selectors if needed."""
    resp = requests.get(url)
    resp.raise_for_status()
    soup = BeautifulSoup(resp.text, "html.parser")

    # Try the original selector for the question
    q_tag = soup.select_one("h1.entry-title")
    if not q_tag:
        # Fallback: try the first h1, then h2, then title
        q_tag = soup.find("h1") or soup.find("h2")
    if not q_tag:
        # Fallback: try the <title>
        q_tag = soup.find("title")
    q = q_tag.get_text(strip=True) if q_tag else "(No question found)"

    # Try the original selector for the answer
    ans_blocks = soup.select("div.entry-content p")
    if not ans_blocks:
        # Fallback: try all <article> <p>, then all <p> under main content
        ans_blocks = soup.select("article p")
    if not ans_blocks:
        # Fallback: try all <p> tags (as last resort)
        ans_blocks = soup.find_all("p")
    ans = "\n\n".join(p.get_text(strip=True) for p in ans_blocks if p.get_text(strip=True))
    if not ans:
        ans = "(No answer found)"

    return {"url": url, "question": q, "answer": ans}

def main():
    print("Discovering categories…")
    cats = get_category_urls()
    print(f"Found {len(cats)} categories\n")

    all_urls = set()
    for cat in cats:
        print(f"Scraping URLs in category {cat} …")
        urls = get_all_article_urls_for_category(cat)
        all_urls |= set(urls)

    print(f"\nTotal unique articles discovered: {len(all_urls)}\n")

    qa = []
    for i, url in enumerate(sorted(all_urls), 1):
        print(f"  ({i}/{len(all_urls)}) {url}")
        try:
            qa.append(scrape_article(url))
        except Exception as e:
            print("   → skipped:", e)
        time.sleep(0.2)

    with open("zebra_support_qa.json", "w", encoding="utf-8") as f:
        json.dump(qa, f, ensure_ascii=False, indent=2)

    print("\nDone! Saved to zebra_support_qa.json")

if __name__ == "__main__":
    main()