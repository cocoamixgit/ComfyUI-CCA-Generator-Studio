"""第29版: ワイルドカード。

プロンプトに __名前__ と書くと、生成のたびに、その名前に登録した行のどれか 1 つに置き換わる。
  - 置き換えはキューに入れるとき(split.py)。乱数はシードから作るので、同じシードなら同じ言葉になる
    (生成情報の「このシードを使う」で同じ画像を作り直せるように)。シードが変われば選ばれる言葉も変わる
  - 行の中にも __名前__ を書ける(8 段まで)。空の行と # で始まる行は使わない
  - 登録の無い名前はそのまま残す
保存先: user/default/cca_generator/wildcards.json
  {"user": {"color": ["red", ...]}, "hidden": ["color", ...]}
  名前は前後の __ を外して覚える。おすすめ(BUILTIN)は最初から使える。編集して保存すると user に同じ名前で入り、
  おすすめより優先する。おすすめを消すと hidden に入る(「消したおすすめを戻す」で戻る)
"""
import random
import re

from . import store
from .i18n import tr

FILE = "wildcards.json"
MAX_ITEMS = 300
MAX_LINES = 2000
MAX_LINE = 1000
MAX_NAME = 60
MAX_DEPTH = 8
# __名前__(名前の中の _ は 1 つずつなら使える: __clothing_cute__)
TOKEN = re.compile(r"__([^\s_,()\[\]{}|<>:]+(?:_[^\s_,()\[\]{}|<>:]+)*)__")
NAME_OK = re.compile(r"^[^\s_,()\[\]{}|<>:]+(?:_[^\s_,()\[\]{}|<>:]+)*$")

# おすすめ(最初から入っているもの)
BUILTIN = {
    "color": """red orange yellow green blue purple pink brown black white gray silver gold blonde aqua teal navy beige
ivory lavender magenta cyan maroon crimson emerald turquoise violet peach mint coral scarlet rainbow burgundy lilac rose amber""",
    "hairstyle": """twintails low_twintails ponytail side_ponytail high_ponytail braid french_braid side_braid twin_braids bun
double_bun braided_bun bob_cut pixie_cut hime_cut blunt_bangs sidelocks ahoge drills twin_drills wavy_hair curly_hair straight_hair
messy_hair spiky_hair short_hair medium_hair long_hair very_long_hair floating_hair wolf_cut mullet side_tail low_ponytail half_updo odango""",
    "clothing_cute": """maid apron headdress lolita dress sundress frilled_dress skirt pleated_skirt blouse cardigan sweater frills lace
ribbon bow hairbow sailor_uniform school_uniform serafuku yukata pajamas hoodie overalls thighhighs kneehighs mary_janes beret bonnet
mittens choker bell pinafore frilled_skirt bloomers petticoat""",
    "clothing_cool": """jacket leather_jacket coat trench_coat blazer vest turtleneck tank_top crop_top shirt boots sneakers jeans shorts
pants leggings miniskirt suit necktie scarf gloves fingerless_gloves choker belt hat cap sunglasses eyepatch mask hood uniform
military_uniform denim_jacket bomber_jacket earrings chain""",
    "clothing_casual": """t-shirt shirt hoodie sweater cardigan jacket coat jeans denim shorts skirt dress pants leggings joggers sneakers
sandals slippers pajamas tank_top crop_top overalls apron cap hat backpack bag watch glasses socks shoes loafers blouse sweatpants
turtleneck parka""",
    "background": """classroom school library cafe park beach forest garden city street alley rooftop bedroom bathroom kitchen office
station train shrine temple castle church mountain river lake ocean island desert snow festival market aquarium convenience_store
greenhouse balcony underwater""",
    "lighting": """morning noon afternoon evening night midnight dawn dusk sunrise sunset golden_hour blue_hour sunlight moonlight starlight
candlelight backlighting sidelight spotlight neon glow silhouette shadow shade overcast cloudy rainy snowy foggy lens_flare bokeh
cinematic twilight dim bright glowing""",
    "action": """standing sitting walking running jumping dancing lying on_back on_stomach kneeling squatting leaning stretching waving
pointing salute praying sleeping reading writing cooking singing swimming flying falling hugging reaching looking_back crossed_arms
hands_on_hips peace_sign thumbs_up holding_hands carrying holding_gun aiming""",
    "props": """umbrella book phone camera bag backpack sword shield staff wand gun knife cup teacup bottle basket flower bouquet balloon
gift box key mirror candle lantern fan notebook pen brush microphone guitar violin stuffed_toy doll teddy_bear parasol""",
}
BUILTIN = {k: v.split() for k, v in BUILTIN.items()}


def norm_name(name):
    """「__color__」「color」「 __color__ 」→「color」。使えない名前は ValueError"""
    s = str(name or "").strip()
    if s.startswith("__") and s.endswith("__") and len(s) > 4:
        s = s[2:-2]
    if not s:
        raise ValueError(tr('ワイルドカードの名前が空です'))
    if len(s) > MAX_NAME or not NAME_OK.match(s):
        raise ValueError(tr('ワイルドカードの名前に使えない文字があります(空白・「,」・かっこ・__ は使えません)'))
    return s


def clean_lines(lines):
    if isinstance(lines, str):
        lines = lines.replace("\r\n", "\n").replace("\r", "\n").split("\n")
    out = []
    for x in lines if isinstance(lines, list) else []:
        t = str(x).strip()[:MAX_LINE]
        if t:
            out.append(t)
        if len(out) >= MAX_LINES:
            break
    return out


def _data():
    d = store._read(FILE, {})
    user = d.get("user") if isinstance(d.get("user"), dict) else {}
    user = {k: clean_lines(v) for k, v in user.items() if isinstance(k, str)}
    hidden = [x for x in d.get("hidden", []) if isinstance(x, str)]
    return user, hidden


def _write(user, hidden):
    store._write(FILE, {"user": user, "hidden": hidden})


def table():
    """使えるワイルドカード {名前: [行]}(おすすめ → 編集した物の順に重ねる。消したおすすめは入れない)"""
    user, hidden = _data()
    out = {k: v for k, v in BUILTIN.items() if k not in hidden}
    out.update(user)
    return out


def listing():
    user, hidden = _data()
    items = []
    for k, v in BUILTIN.items():
        if k in hidden and k not in user:
            continue
        items.append({"name": k, "lines": user.get(k, v), "builtin": True, "edited": k in user})
    for k, v in user.items():
        if k not in BUILTIN:
            items.append({"name": k, "lines": v, "builtin": False, "edited": False})
    return {"items": items, "hidden": sum(1 for k in hidden if k in BUILTIN and k not in user)}


def save(name, lines, old=None):
    """保存(同じ名前は上書き)。old があり名前が変わったら、元の名前のエントリを消す(名前の付け替え)"""
    name = norm_name(name)
    lines = clean_lines(lines)
    if not any(not x.startswith("#") for x in lines):
        raise ValueError(tr('ワイルドカードの中身が空です(1 行に 1 つずつ書きます)'))
    with store._lock:
        user, hidden = _data()
        if name not in user and name not in BUILTIN and len(user) >= MAX_ITEMS:
            raise ValueError(tr('ワイルドカードの数の上限です'))
        user[name] = lines
        if name in hidden:
            hidden.remove(name)
        if old:
            try:
                o = norm_name(old)
            except ValueError:
                o = None
            if o and o != name:
                user.pop(o, None)
                if o in BUILTIN and o not in hidden:
                    hidden.append(o)
        _write(user, hidden)
    return name


def delete(name, revert=False):
    """消す。おすすめは一覧から外す(hidden)。revert=True ならおすすめの中身に戻すだけ(編集した内容を消す)"""
    name = norm_name(name)
    with store._lock:
        user, hidden = _data()
        existed = user.pop(name, None) is not None
        if not revert and name in BUILTIN and name not in hidden:
            hidden.append(name)
            existed = True
        _write(user, hidden)
    return existed


def unhide():
    with store._lock:
        user, hidden = _data()
        n = sum(1 for k in hidden if k in BUILTIN)
        _write(user, [])
    return n


# ---------------------------------------------------------------- 置き換え
def expand(text, rng, tab, depth=0):
    """text の __名前__ を、tab の行のどれか(rng で選ぶ)に置き換える。行の中の __名前__ も置き換える"""
    if not text or "__" not in text:
        return text

    def rep(m):
        lines = [x for x in tab.get(m.group(1)) or [] if not x.startswith("#")]
        if not lines:
            return m.group(0)
        pick = rng.choice(lines)
        return expand(pick, rng, tab, depth + 1) if depth + 1 < MAX_DEPTH else pick

    return TOKEN.sub(rep, text)


def resolve(positive, negative, seed):
    """(置き換えたプロンプト, 置き換えたネガティブ)。同じシードなら同じ結果"""
    if "__" not in str(positive or "") and "__" not in str(negative or ""):
        return positive, negative
    tab = table()
    try:
        s = int(seed)
    except (TypeError, ValueError):
        s = 0
    rng = random.Random(f"cca-wildcard-{s}")
    return expand(str(positive or ""), rng, tab), expand(str(negative or ""), rng, tab)
