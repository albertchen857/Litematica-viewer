import requests
from django.views.decorators.http import condition

api_url = "https://redenmc.com/api/mc-services/litematica/search"

params = {
    "q": "世吞",
    "limit": 24,
    "offset": 0
}

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36",
    "Referer": "https://redenmc.com/"
}

response = requests.get(api_url, params=params, headers=headers)

if response.status_code == 200:
    data = response.json()
    items = data.get('d', [])
    print(f"成功获取 {len(items)} 条数据")
else:
    print(f"请求失败，状态码：{response.status_code}")

import pandas as pd

x,y,z = 0,0,0
rows = []
for item in items:
    type = item.get("type")
    id = item.get("key")
    row = {
        "机器名称": item.get("name"),
        "作者": item.get("author", {}).get("username"),
        "下载量": item.get("downloads"),
        "点赞量": item.get("upVotes"),
        "文件格式": type ,
        "适用版本": ", ".join(item.get("versions", "")),
        "外部链接": item.get("link", ""),
        "页面链接": f"https://redenmc.com/litematica/{id}",
        "图片链接": item.get("imageUrl")
    }
    if type == "LitematicaGen":
        cdx = ", ".join(item.get("conditions").get("x", ""))
        cdy = ", ".join(item.get("conditions").get("y", ""))
        cdz = ", ".join(item.get("conditions").get("z", ""))
        print(cdy)
        # x = input(f"注意{cdx}, x:")
        # y = input(f"注意{cdy}, y:")
        # z = input(f"注意{cdz}, z:")
        if cdx != "":
            x = cdx.split("min(")[1].split(")")[0]
        if cdy != "":
            y = cdy.split("min(")[1].split(")")[0]
        if cdz != "":
            z = cdz.split("min(")[1].split(")")[0]
        row["下载链接"] = f"https://redenmc.com/api/mc-services/yisibite/{id}?xSize={x}&ySize={y}&zSize={z}"
    else:
        row["下载链接"] = f"https://redenmc.com/api/mc-services/yisibite/{id}/download/1"
    rows.append(row)

df = pd.DataFrame(rows)

print(df)

df.to_csv("reden_data.csv", index=False, encoding="utf_8_sig")
print("数据已保存到 reden_data.csv")