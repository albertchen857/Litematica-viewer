"""LitematicaViewer 的核心包。

模块划分（每个文件只干一件事）::

    config.py       资源路径、主题色、字体、设置持久化、跨平台小工具
    i18n.py         语言系统：lang/source/*.json -> .po/.mo -> gettext
    model.py        统一结构模型（三种文件格式都先转成它再分析）
    formats.py      .litematic / .nbt / .mcstructure 的读写
    blockmap.py     Java <-> Bedrock 方块 ID 与状态的互相映射
    analysis.py     方块统计、分类、容器解析
    edit.py         生成图形投影、批量替换方块、跨版本转换
    render.py       3D 渲染桥：把结构写成 payload.json，用独立子进程开网页版查看器（docs/viewer）
    atlas.py        方块 / 物品图标：从共用的贴图图集里裁，不再存上千张 png
    ui_widgets.py   通用控件（可收纳面板等）
    ui_main.py      主窗口
    ui_step.py      步骤查看器
    ui_container.py 容器分析器
"""

from .config import APP_NAME, APP_VERSION

__all__ = ["APP_NAME", "APP_VERSION"]
