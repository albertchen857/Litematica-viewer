import requests
from django.views.decorators.http import condition

api_url = "https://api.earthmc.net/v4/players"

data = {
  "query": [
    "AFB_"
  ]
}

headers = {
    "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
}

response = requests.get(api_url, data=data, headers=headers)

if response.status_code == 200:
    data = response.json()
    items = data.get(0)
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
        "name": item.get("name"),
        "nation": item.get("nation", {}).get("name"),
        "town": item.get("town", {}).get("name"),
        "UUID": item.get("uuid"),
    }

df = pd.DataFrame(rows)

print(df)

# df.to_csv("reden_data.csv", index=False, encoding="utf_8_sig")
# print("数据已保存到 reden_data.csv")