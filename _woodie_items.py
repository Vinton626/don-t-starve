# -*- coding: utf-8 -*-
import json
from pathlib import Path

path = Path("data/woodie.json")
raw = path.read_text(encoding="utf-8")
data = json.loads(raw)

def splice(raw, old, new):
    key = json.dumps(old, ensure_ascii=False)
    val = json.dumps(new, ensure_ascii=False)
    idx = raw.find(key)
    assert idx != -1, old[:30]
    assert raw.find(key, idx + 1) == -1, "duplicate " + old[:30]
    return raw[:idx] + val + raw[idx + len(key):]

def statue(text, form):
    assert form in text
    out = text
    out = out.replace("25点饥饿值", "<b>25点</b><hunger>饥饿值</hunger>", 1)
    out = out.replace("20点生命值", "<b>20点</b><health>生命值</health>", 1)
    out = out.replace("15点精神值", "<b>15点</b><sanity>精神值</sanity>", 1)
    return out

lucy = data["exclusiveItems"]["items"][0]["desc"]
lucy_new = lucy.replace("\n", "<br>")
lucy_new = lucy_new.replace("1×", "<b>1</b>×", 1)
lucy_new = lucy_new.replace("13.6", "<b>13.6</b>", 1)
lucy_new = lucy_new.replace("2倍", "<b>2倍</b>", 1)

statues = []
for item in data["exclusiveItems"]["items"][1:]:
    form = item["name"].replace("俗气", "").replace("像", "")
    statues.append((item["desc"], statue(item["desc"], form)))

guard = data["craftItems"]["items"][0]["desc"]
guard_new = guard.replace("3分钟", "<b>3分钟</b>", 1).replace("2.5个", "<b>2.5个</b>", 1)
assert "<b>2×堆叠数量</b>" in guard_new

hat = data["craftItems"]["items"][1]["desc"]
hat_new = hat.replace("70%", "<b>70%</b>", 1).replace("262.5", "<b>262.5</b>", 1)
hat_new = hat_new.replace("3分钟", "<b>3分钟</b>", 1).replace("100%", "<b>100%</b>", 1)

cane = data["craftItems"]["items"][2]["desc"]
cane_new = cane.replace("\n", "<br>")
cane_new = cane_new.replace("1.15倍", "<b>1.15倍</b>", 1).replace("4天", "<b>4天</b>", 1)
cane_new = cane_new.replace("3分钟", "<b>3分钟</b>", 1).replace("10点", "<b>10点</b>", 1)
assert "<warn>徒手攻击的动作</warn>" in cane_new

pairs = [(lucy, lucy_new), *statues, (guard, guard_new), (hat, hat_new), (cane, cane_new)]
for old, new in pairs:
    assert old != new
    assert "<b><b>" not in new
    assert "undefined" not in new
    raw = splice(raw, old, new)

check = json.loads(raw)
recipes = [i["recipe"] for i in data["exclusiveItems"]["items"]]
assert [i["recipe"] for i in check["exclusiveItems"]["items"]] == recipes
assert check["exclusiveItems"]["items"][0]["desc"] == lucy_new
assert "<br>" in check["exclusiveItems"]["items"][0]["desc"]
assert "\n" not in check["craftItems"]["items"][2]["desc"]
assert "<character>" not in raw[raw.find('"exclusiveItems"'):]
path.write_text(raw, encoding="utf-8", newline="\n")
print("ok", len(pairs))
