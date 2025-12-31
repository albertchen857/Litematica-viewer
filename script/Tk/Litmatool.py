import json, subprocess, sys, os

def grs(relative_path):
    """
    动态获取资源的绝对路径
    :param relative_path: PATH with if multiple layers os.path.join()
    """
    if hasattr(sys, '_MEIPASS'):
        # 打包后的资源在临时目录
        base_path = sys._MEIPASS
    else:
        # 开发环境：从 main.py 所在目录（src/）的父目录（即项目根目录）访问资源
        base_path = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    return os.path.join(base_path, relative_path)

json_data = json.load(open(grs(os.path.join('lang', 'setting.json')), 'r', encoding='utf-8'))

def convert_units(number,lang):
    units = {'箱': 54 * 27 * 64, '盒': 27 * 64, '组': 64, '个': 1} if lang == "zh" else {'LargeChest': 54 * 27 * 64, 'Box': 27 * 64, 'S': 64, 'U': 1}
    result = ""
    for unit, value in units.items():
        if number >= value:
            count = number // value
            result += f"{count}{unit}"
            number %= value
    return result if result else "0个"

def cn_translate(id, key: bool = True, types = "Blocks") -> str:
    """
    CN translate
    :param id: Object ID translate
    :param key: False: value(CN) to key(EN) | True: key(EN) to value(CN)
    :param types: transfer dist type
    :return: Object Chinese name
    """
    if key:
        return json_data[types].get(id, id)
    else:
        for k, v in json_data[types].items():
            if v == id:
                return k
        return id

def manual_install_pk():
    try:
        result = subprocess.run([grs('install.bat')], check=True, capture_output=True, text=True)
        print("Packages install successfully")
        print(result.stdout)
    except subprocess.CalledProcessError as e:
        print(e.stderr)

def find_keys_by_value_in_list(dictionary, target_value):
    return [key for key, value_list in dictionary.items() if target_value in value_list]

def Category_Tran(data):
    """find block category which belongs to"""
    for key, value_list in json_data["Category"].items():
        for prop in data.split("_"):
            if prop in value_list:
                return key
    return ""

def id_tran_name(id: object) -> object:
    """
    minecraft:ID -> ID
    :rtype: object
    """
    return id.split(':')[1]