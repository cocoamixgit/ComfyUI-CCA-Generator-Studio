"""同梱ワークフローの表示(ノード名・入力名・メモ)を言語パックで訳したコピーを作る。

    python tools/translate_workflow.py <元のワークフロー.json> <言語> <出力.json>
    例: python tools/translate_workflow.py ../cca_generator_workflow.json en ../cca_generator_workflow_en.json

訳すのは表示だけ(title・label・メモの文)。値や名前(name・widgets の値)は変えないので、動きは元と同じ。
訳が無い文は日本語のまま残し、最後に一覧を出す。
"""
import json
import os
import re
import sys

JP = re.compile(r"[぀-ヿ㐀-鿿]")
HERE = os.path.dirname(os.path.abspath(__file__))


def load_pack(code):
    path = os.path.join(HERE, "..", "locales", code, "cca_panel.json")
    with open(path, encoding="utf-8") as f:
        return json.load(f).get("strings", {})


def tr_md(text, pack, missing):
    """メモ(Markdown)は行ごとに訳す(見出し・箇条書きの印はそのまま)"""
    out = []
    for line in text.split("\n"):
        m = re.match(r"^(\s*(?:#{1,3}\s+|- |\d+\. )?)(.*?)(\s*)$", line)
        head, body, tail = m.groups()
        if body and JP.search(body):
            t = pack.get(body)
            if t is None:
                missing.add(body)
                t = body
            line = head + t + tail
        out.append(line)
    return "\n".join(out)


def translate(wf, pack):
    missing = set()

    def tr(s):
        if not JP.search(s):
            return s
        t = pack.get(s)
        if t is None:
            missing.add(s)
            return s
        return t

    def walk(v):
        if isinstance(v, dict):
            for k, x in list(v.items()):
                if k in ("title", "label") and isinstance(x, str):
                    v[k] = tr(x)
                elif k == "widgets_values" and v.get("type") in ("MarkdownNote", "Note") and isinstance(x, list):
                    v[k] = [tr_md(s, pack, missing) if isinstance(s, str) else s for s in x]
                else:
                    walk(x)
        elif isinstance(v, list):
            for x in v:
                walk(x)

    walk(wf)
    return missing


def main():
    src, code, dst = sys.argv[1:4]
    with open(src, encoding="utf-8") as f:
        wf = json.load(f)
    missing = translate(wf, load_pack(code))
    with open(dst, "w", encoding="utf-8") as f:
        json.dump(wf, f, ensure_ascii=False, indent=1)
    print(f"wrote {dst}")
    for s in sorted(missing):
        print("  訳なし:", s[:100].replace("\n", " "))


if __name__ == "__main__":
    main()
