import litemapy, json
from tkinter import filedialog

def get_schematic_bounds(schematic):
    """计算 schematic 的最大边界值"""
    x_coords = []
    y_coords = []
    z_coords = []
    for region_name, region in schematic.regions.items():
        for x, y, z in region.block_positions():
            x_coords.append(x)
            y_coords.append(y)
            z_coords.append(z)
    return max(x_coords), max(y_coords), max(z_coords), min(x_coords), min(y_coords), min(z_coords)

def create_structure(block_id: str, start_coords: tuple, dimensions: tuple, hollow: bool, wall_thickness: int, faces: list[int]) -> None:
    if start_coords == ('', '', ''):
        cx, cy, cz = (0,0,0)
    else:
        cx, cy, cz = start_coords
        cx, cy, cz = int(cx), int(cy), int(cz)
    if dimensions == ('', '', ''):
        width, height, length = (1,1,1)
    else:
        width, height, length = dimensions
        width, height, length = int(width), int(height), int(length)
    block_id = block_id if block_id else "minecraft:cobblestone"
    print(f"{block_id},{(cx, cy, cz, width, height, length)}")
    region = litemapy.Region(0, 0, 0, width, height, length)
    schematic = region.as_schematic()
    block = litemapy.BlockState(block_id)
    for x in range(width):
        for y in range(height):
            for z in range(length):

                is_on_face = (
                    (faces[0] and z < wall_thickness) or  # 前面
                    (faces[1] and z >= width - wall_thickness) or  # 后面
                    (faces[2] and x < wall_thickness) or  # 左面
                    (faces[3] and x >= length - wall_thickness) or  # 右面
                    (faces[4] and y < wall_thickness) or  # 下面
                    (faces[5] and y >= height - wall_thickness)  # 上面
                )
                if hollow:
                    if is_on_face:
                        region[x + cx, y + cy, z + cz] = block
                else:
                    region[x + cx, y + cy, z + cz] = block

                region[x + cx, y + cy, z + cz] = block
    save_Schematic(schematic,"Cube")

# {"minecraft:iron_block":"minecraft:dirt"}
def change_Schematic(schematic, change_list : dict[str:[str,dict,dict]], limit: tuple, file_name):
    print(change_list)
    (xmin, xmax), (ymin, ymax), (zmin, zmax) = limit
    maxx, maxy, maxz, minx, miny, minz = get_schematic_bounds(schematic)
    #print(f"BoundsRegion: xmin={minx}, xmax={maxx}, ymin={miny}, ymax={maxy}, zmin={minz}, zmax={maxz}")
    # 动态设置边界条件
    xmin = minx if xmin == '' else minx-int(xmin) if int(xmin) < minx else int(xmin)
    xmax = maxx if xmax == '' else maxx-int(xmax) if int(xmax) > maxx else int(xmax)
    ymin = miny if ymin == '' else miny-int(ymin) if int(ymin) < miny else int(ymin)
    ymax = maxy if ymax == '' else maxy-int(ymax) if int(ymax) > maxy else int(ymax)
    zmin = minz if zmin == '' else minx-int(zmin) if int(zmin) < minz else int(zmin)
    zmax = maxz if zmax == '' else maxz-int(zmax) if int(zmax) > maxz else int(zmax)

    print(f"BoundsInputFixed: xmin={xmin}, xmax={xmax}, ymin={ymin}, ymax={ymax}, zmin={zmin}, zmax={zmax}")

    for region_name, region in schematic.regions.items():
        block_positions = list(region.block_positions())
        print(f"Block positions in region {region_name}: {block_positions}")

        for x, y, z in block_positions: #漏斗{"facing":"west"}-漏斗{"facing":"down"}
            if xmin <= x <= xmax and ymin <= y <= ymax and zmin <= z <= zmax:
                block = region[x, y, z]
                #print(f"Processing block at ({x}, {y}, {z}): {block.id}")
                if block.id not in change_list:
                    continue
                properties = block._BlockState__properties
                replace, iprop, fprop = change_list[block.id]
                #print(f"prop{properties}|{(iprop,fprop)}")
                if not (iprop.items() <= properties.items()):
                    continue
                for prop, val in fprop.items():
                    if prop in properties:
                        properties[prop] = val
                if properties:
                    new_block = litemapy.BlockState(replace, **properties)
                else:
                    new_block = litemapy.BlockState(replace)
                region[x, y, z] = new_block


    save_Schematic(schematic, file_name)
    print(f"Schematic saved to {file_name}")

def save_Schematic(sche,file_name) -> None:
    file_path = filedialog.asksaveasfilename(
        defaultextension=".litematic",
        filetypes=[("Litematic File", "*.litematic"), ("All Files", "*.*")],
        title="Litematica Structure File Save As",
        initialfile=f"{file_name}.litematic"
    )
    if not file_path: return
    sche.save(file_path)
    print(f"文件已保存到: {file_path}")
    return