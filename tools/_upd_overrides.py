# -*- coding: utf-8 -*-
import json, os

p = os.path.join(os.path.dirname(os.path.abspath(__file__)), 'overrides.json')
d = json.load(open(p, encoding='utf-8'))
add = {
    "pier": {"gloss": "桥墩、墩子；栈桥式码头", "category": "钢结构建筑"},
    "rising damp": {"gloss": "上升湿气、墙体返潮", "category": "建筑设计"},
    "markup": {"gloss": "加成、加价率；标红修改", "category": "外贸商务"},
    "nominated subcontractor": {"gloss": "指定分包商（业主点名）", "category": "工程合同"},
    "succession plan": {"gloss": "继任计划、接班人计划", "category": "职场管理"},
}
d.update(add)
with open(p, 'w', encoding='utf-8') as f:
    json.dump(d, f, ensure_ascii=False, indent=2)
print('overrides 条目数:', len(d))
