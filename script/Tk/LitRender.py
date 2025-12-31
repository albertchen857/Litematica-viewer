import json, os
import tkinter as tk
from OpenGL.GL import *
from OpenGL.GLU import *
from PIL import Image, ImageTk
import numpy as np
from collections import Counter
from pyopengltk import OpenGLFrame
from Litmatool import grs


#blocks1 = [((0, 17, 5), 'minecraft:piston'), ((0, 17, 6), 'minecraft:piston'), ((0, 17, 10), 'minecraft:piston'), ((0, 17, 11), 'minecraft:piston'), ((0, 18, 5), 'minecraft:white_stained_glass'), ((0, 18, 6), 'minecraft:snow_block'), ((0, 18, 7), 'minecraft:observer'), ((0, 18, 8), 'minecraft:observer'), ((0, 18, 9), 'minecraft:observer'), ((0, 18, 10), 'minecraft:snow_block'), ((0, 18, 11), 'minecraft:white_stained_glass'), ((0, 19, 8), 'minecraft:snow_block'), ((0, 20, 8), 'minecraft:observer'), ((0, 21, 7), 'minecraft:dropper'), ((0, 21, 8), 'minecraft:observer'), ((1, 15, 5), 'minecraft:piston'), ((1, 15, 6), 'minecraft:piston'), ((1, 15, 8), 'minecraft:end_stone_brick_wall'), ((1, 15, 10), 'minecraft:piston'), ((1, 15, 11), 'minecraft:piston'), ((1, 16, 5), 'minecraft:soul_soil'), ((1, 16, 6), 'minecraft:soul_soil'), ((1, 16, 7), 'minecraft:observer'), ((1, 16, 8), 'minecraft:iron_trapdoor'), ((1, 16, 9), 'minecraft:observer'), ((1, 16, 10), 'minecraft:soul_soil'), ((1, 16, 11), 'minecraft:soul_soil'), ((1, 17, 4), 'minecraft:blue_ice'), ((1, 17, 5), 'minecraft:basalt'), ((1, 17, 6), 'minecraft:basalt'), ((1, 17, 7), 'minecraft:blue_ice'), ((1, 17, 8), 'minecraft:observer'), ((1, 17, 9), 'minecraft:blue_ice'), ((1, 17, 10), 'minecraft:basalt'), ((1, 17, 11), 'minecraft:basalt'), ((1, 17, 12), 'minecraft:blue_ice'), ((1, 18, 4), 'minecraft:white_stained_glass'), ((1, 18, 5), 'minecraft:lava'), ((1, 18, 6), 'minecraft:lava'), ((1, 18, 7), 'minecraft:white_stained_glass'), ((1, 18, 8), 'minecraft:end_stone_brick_wall'), ((1, 18, 9), 'minecraft:white_stained_glass'), ((1, 18, 10), 'minecraft:lava'), ((1, 18, 11), 'minecraft:lava'), ((1, 18, 12), 'minecraft:white_stained_glass'), ((1, 19, 5), 'minecraft:piston'), ((1, 19, 6), 'minecraft:piston'), ((1, 19, 7), 'minecraft:white_stained_glass'), ((1, 19, 8), 'minecraft:birch_fence_gate'), ((1, 19, 9), 'minecraft:white_stained_glass'), ((1, 19, 10), 'minecraft:piston'), ((1, 19, 11), 'minecraft:piston'), ((1, 20, 5), 'minecraft:white_stained_glass'), ((1, 20, 6), 'minecraft:snow_block'), ((1, 20, 7), 'minecraft:observer'), ((1, 20, 8), 'minecraft:observer'), ((1, 20, 9), 'minecraft:observer'), ((1, 20, 10), 'minecraft:snow_block'), ((1, 20, 11), 'minecraft:white_stained_glass'), ((1, 21, 6), 'minecraft:anvil'), ((1, 21, 8), 'minecraft:snow_block'), ((1, 21, 10), 'minecraft:anvil'), ((1, 22, 4), 'minecraft:snow_block'), ((1, 22, 5), 'minecraft:sticky_piston'), ((1, 22, 6), 'minecraft:observer'), ((1, 23, 4), 'minecraft:redstone_wire'), ((2, 9, 4), 'minecraft:piston'), ((2, 9, 5), 'minecraft:piston'), ((2, 9, 6), 'minecraft:piston'), ((2, 9, 7), 'minecraft:piston'), ((2, 9, 8), 'minecraft:piston'), ((2, 9, 9), 'minecraft:piston'), ((2, 9, 10), 'minecraft:piston'), ((2, 9, 11), 'minecraft:piston'), ((2, 9, 12), 'minecraft:piston'), ((2, 10, 2), 'minecraft:snow_block'), ((2, 10, 3), 'minecraft:note_block'), ((2, 10, 4), 'minecraft:observer'), ((2, 10, 5), 'minecraft:snow_block'), ((2, 10, 6), 'minecraft:note_block'), ((2, 10, 7), 'minecraft:observer'), ((2, 10, 8), 'minecraft:snow_block'), ((2, 10, 9), 'minecraft:note_block'), ((2, 10, 10), 'minecraft:observer'), ((2, 10, 11), 'minecraft:snow_block'), ((2, 10, 12), 'minecraft:note_block'), ((2, 10, 13), 'minecraft:observer'), ((2, 10, 14), 'minecraft:snow_block'), ((2, 11, 3), 'minecraft:stone_button'), ((2, 11, 6), 'minecraft:stone_button'), ((2, 11, 9), 'minecraft:stone_button'), ((2, 11, 12), 'minecraft:stone_button'), ((2, 14, 5), 'minecraft:soul_soil'), ((2, 14, 6), 'minecraft:soul_soil'), ((2, 14, 10), 'minecraft:soul_soil'), ((2, 14, 11), 'minecraft:soul_soil'), ((2, 15, 4), 'minecraft:blue_ice'), ((2, 15, 5), 'minecraft:basalt'), ((2, 15, 6), 'minecraft:basalt'), ((2, 15, 7), 'minecraft:blue_ice'), ((2, 15, 8), 'minecraft:observer'), ((2, 15, 9), 'minecraft:blue_ice'), ((2, 15, 10), 'minecraft:basalt'), ((2, 15, 11), 'minecraft:basalt'), ((2, 15, 12), 'minecraft:blue_ice'), ((2, 16, 4), 'minecraft:white_stained_glass'), ((2, 16, 5), 'minecraft:lava'), ((2, 16, 6), 'minecraft:lava'), ((2, 16, 7), 'minecraft:white_stained_glass'), ((2, 16, 8), 'minecraft:white_stained_glass_pane'), ((2, 16, 9), 'minecraft:white_stained_glass'), ((2, 16, 10), 'minecraft:lava'), ((2, 16, 11), 'minecraft:lava'), ((2, 16, 12), 'minecraft:white_stained_glass'), ((2, 17, 4), 'minecraft:white_stained_glass'), ((2, 17, 5), 'minecraft:basalt'), ((2, 17, 6), 'minecraft:basalt'), ((2, 17, 7), 'minecraft:piston'), ((2, 17, 8), 'minecraft:observer'), ((2, 17, 9), 'minecraft:piston'), ((2, 17, 10), 'minecraft:basalt'), ((2, 17, 11), 'minecraft:basalt'), ((2, 17, 12), 'minecraft:white_stained_glass'), ((2, 18, 4), 'minecraft:white_stained_glass'), ((2, 18, 5), 'minecraft:soul_soil'), ((2, 18, 6), 'minecraft:soul_soil'), ((2, 18, 7), 'minecraft:white_stained_glass'), ((2, 18, 8), 'minecraft:snow_block'), ((2, 18, 9), 'minecraft:white_stained_glass'), ((2, 18, 10), 'minecraft:soul_soil'), ((2, 18, 11), 'minecraft:soul_soil'), ((2, 18, 12), 'minecraft:white_stained_glass'), ((2, 19, 4), 'minecraft:blue_ice'), ((2, 19, 5), 'minecraft:basalt'), ((2, 19, 6), 'minecraft:basalt'), ((2, 19, 7), 'minecraft:blue_ice'), ((2, 19, 8), 'minecraft:white_stained_glass'), ((2, 19, 9), 'minecraft:blue_ice'), ((2, 19, 10), 'minecraft:basalt'), ((2, 19, 11), 'minecraft:basalt'), ((2, 19, 12), 'minecraft:blue_ice'), ((2, 20, 4), 'minecraft:white_stained_glass'), ((2, 20, 5), 'minecraft:lava'), ((2, 20, 6), 'minecraft:lava'), ((2, 20, 7), 'minecraft:white_stained_glass'), ((2, 20, 8), 'minecraft:white_stained_glass'), ((2, 20, 9), 'minecraft:white_stained_glass'), ((2, 20, 10), 'minecraft:lava'), ((2, 20, 11), 'minecraft:lava'), ((2, 20, 12), 'minecraft:white_stained_glass'), ((2, 21, 4), 'minecraft:white_stained_glass'), ((2, 21, 5), 'minecraft:piston'), ((2, 21, 6), 'minecraft:piston'), ((2, 21, 7), 'minecraft:white_stained_glass'), ((2, 21, 8), 'minecraft:iron_door'), ((2, 21, 9), 'minecraft:white_stained_glass'), ((2, 21, 10), 'minecraft:piston'), ((2, 21, 11), 'minecraft:piston'), ((2, 21, 12), 'minecraft:white_stained_glass'), ((2, 22, 4), 'minecraft:white_stained_glass'), ((2, 22, 6), 'minecraft:snow_block'), ((2, 22, 7), 'minecraft:observer'), ((2, 22, 8), 'minecraft:iron_door'), ((2, 22, 9), 'minecraft:observer'), ((2, 22, 10), 'minecraft:snow_block'), ((2, 23, 4), 'minecraft:redstone_wire'), ((2, 29, 5), 'minecraft:white_stained_glass'), ((2, 29, 6), 'minecraft:white_stained_glass'), ((2, 30, 5), 'minecraft:redstone_wire'), ((2, 30, 6), 'minecraft:redstone_wire'), ((3, 9, 2), 'minecraft:white_stained_glass'), ((3, 9, 4), 'minecraft:white_stained_glass'), ((3, 9, 5), 'minecraft:white_stained_glass'), ((3, 9, 6), 'minecraft:white_stained_glass'), ((3, 9, 7), 'minecraft:white_stained_glass'), ((3, 9, 8), 'minecraft:white_stained_glass'), ((3, 9, 9), 'minecraft:white_stained_glass'), ((3, 9, 10), 'minecraft:white_stained_glass'), ((3, 9, 11), 'minecraft:white_stained_glass'), ((3, 9, 12), 'minecraft:white_stained_glass'), ((3, 9, 14), 'minecraft:white_stained_glass'), ((3, 10, 2), 'minecraft:repeater'), ((3, 10, 4), 'minecraft:white_stained_glass'), ((3, 10, 5), 'minecraft:white_stained_glass'), ((3, 10, 6), 'minecraft:white_stained_glass'), ((3, 10, 7), 'minecraft:white_stained_glass'), ((3, 10, 8), 'minecraft:white_stained_glass'), ((3, 10, 9), 'minecraft:white_stained_glass'), ((3, 10, 10), 'minecraft:white_stained_glass'), ((3, 10, 11), 'minecraft:white_stained_glass'), ((3, 10, 12), 'minecraft:white_stained_glass'), ((3, 10, 14), 'minecraft:repeater'), ((3, 11, 4), 'minecraft:white_stained_glass'), ((3, 11, 5), 'minecraft:white_stained_glass'), ((3, 11, 6), 'minecraft:white_stained_glass'), ((3, 11, 7), 'minecraft:white_stained_glass'), ((3, 11, 8), 'minecraft:white_stained_glass'), ((3, 11, 9), 'minecraft:white_stained_glass'), ((3, 11, 10), 'minecraft:white_stained_glass'), ((3, 11, 11), 'minecraft:white_stained_glass'), ((3, 11, 12), 'minecraft:white_stained_glass'), ((3, 12, 4), 'minecraft:white_stained_glass'), ((3, 12, 5), 'minecraft:white_stained_glass'), ((3, 12, 6), 'minecraft:white_stained_glass'), ((3, 12, 7), 'minecraft:white_stained_glass'), ((3, 12, 8), 'minecraft:white_stained_glass'), ((3, 12, 9), 'minecraft:white_stained_glass'), ((3, 12, 10), 'minecraft:white_stained_glass'), ((3, 12, 11), 'minecraft:white_stained_glass'), ((3, 12, 12), 'minecraft:white_stained_glass'), ((3, 13, 4), 'minecraft:white_stained_glass'), ((3, 13, 5), 'minecraft:white_stained_glass'), ((3, 13, 6), 'minecraft:white_stained_glass'), ((3, 13, 7), 'minecraft:white_stained_glass'), ((3, 13, 8), 'minecraft:white_stained_glass'), ((3, 13, 9), 'minecraft:white_stained_glass'), ((3, 13, 10), 'minecraft:white_stained_glass'), ((3, 13, 11), 'minecraft:white_stained_glass'), ((3, 13, 12), 'minecraft:white_stained_glass'), ((3, 14, 4), 'minecraft:white_stained_glass'), ((3, 14, 5), 'minecraft:white_stained_glass'), ((3, 14, 6), 'minecraft:white_stained_glass'), ((3, 14, 7), 'minecraft:white_stained_glass'), ((3, 14, 8), 'minecraft:white_stained_glass'), ((3, 14, 9), 'minecraft:white_stained_glass'), ((3, 14, 10), 'minecraft:white_stained_glass'), ((3, 14, 11), 'minecraft:white_stained_glass'), ((3, 14, 12), 'minecraft:white_stained_glass'), ((3, 15, 4), 'minecraft:iron_block'), ((3, 15, 5), 'minecraft:basalt'), ((3, 15, 6), 'minecraft:basalt'), ((3, 15, 7), 'minecraft:piston'), ((3, 15, 8), 'minecraft:snow_block'), ((3, 15, 9), 'minecraft:piston'), ((3, 15, 10), 'minecraft:basalt'), ((3, 15, 11), 'minecraft:basalt'), ((3, 15, 12), 'minecraft:iron_block'), ((3, 16, 4), 'minecraft:iron_block'), ((3, 16, 5), 'minecraft:iron_block'), ((3, 16, 6), 'minecraft:white_stained_glass'), ((3, 16, 7), 'minecraft:soul_soil'), ((3, 16, 9), 'minecraft:soul_soil'), ((3, 16, 10), 'minecraft:white_stained_glass'), ((3, 16, 11), 'minecraft:iron_block'), ((3, 16, 12), 'minecraft:iron_block'), ((3, 17, 4), 'minecraft:iron_block'), ((3, 17, 5), 'minecraft:basalt'), ((3, 17, 6), 'minecraft:basalt'), ((3, 17, 7), 'minecraft:basalt'), ((3, 17, 8), 'minecraft:blue_ice'), ((3, 17, 9), 'minecraft:basalt'), ((3, 17, 10), 'minecraft:basalt'), ((3, 17, 11), 'minecraft:basalt'), ((3, 17, 12), 'minecraft:iron_block'), ((3, 18, 4), 'minecraft:iron_block'), ((3, 18, 5), 'minecraft:iron_block'), ((3, 18, 6), 'minecraft:white_stained_glass'), ((3, 18, 7), 'minecraft:lava'), ((3, 18, 8), 'minecraft:white_stained_glass'), ((3, 18, 9), 'minecraft:lava'), ((3, 18, 10), 'minecraft:white_stained_glass'), ((3, 18, 11), 'minecraft:iron_block'), ((3, 18, 12), 'minecraft:iron_block'), ((3, 19, 4), 'minecraft:iron_block'), ((3, 19, 5), 'minecraft:basalt'), ((3, 19, 6), 'minecraft:basalt'), ((3, 19, 7), 'minecraft:piston'), ((3, 19, 8), 'minecraft:snow_block'), ((3, 19, 9), 'minecraft:piston'), ((3, 19, 10), 'minecraft:basalt'), ((3, 19, 11), 'minecraft:basalt'), ((3, 19, 12), 'minecraft:iron_block'), ((3, 20, 4), 'minecraft:iron_block'), ((3, 20, 5), 'minecraft:soul_soil'), ((3, 20, 6), 'minecraft:soul_soil'), ((3, 20, 7), 'minecraft:white_stained_glass'), ((3, 20, 8), 'minecraft:observer'), ((3, 20, 9), 'minecraft:white_stained_glass'), ((3, 20, 10), 'minecraft:soul_soil'), ((3, 20, 11), 'minecraft:soul_soil'), ((3, 20, 12), 'minecraft:iron_block'), ((3, 21, 3), 'minecraft:white_stained_glass'), ((3, 21, 4), 'minecraft:lava'), ((3, 21, 5), 'minecraft:basalt'), ((3, 21, 6), 'minecraft:basalt'), ((3, 21, 7), 'minecraft:lava'), ((3, 21, 8), 'minecraft:white_stained_glass_pane'), ((3, 21, 9), 'minecraft:lava'), ((3, 21, 10), 'minecraft:basalt'), ((3, 21, 11), 'minecraft:basalt'), ((3, 21, 12), 'minecraft:lava'), ((3, 21, 13), 'minecraft:white_stained_glass'), ((3, 22, 4), 'minecraft:white_stained_glass'), ((3, 22, 5), 'minecraft:blue_ice'), ((3, 22, 6), 'minecraft:blue_ice'), ((3, 22, 8), 'minecraft:observer'), ((3, 22, 10), 'minecraft:blue_ice'), ((3, 22, 11), 'minecraft:blue_ice'), ((3, 23, 4), 'minecraft:redstone_wire'), ((3, 29, 6), 'minecraft:white_stained_glass'), ((3, 30, 5), 'minecraft:snow_block'), ((3, 30, 6), 'minecraft:comparator'), ((3, 33, 5), 'minecraft:observer'), ((4, 9, 3), 'minecraft:white_stained_glass'), ((4, 9, 4), 'minecraft:smooth_quartz_slab'), ((4, 9, 5), 'minecraft:smooth_quartz_slab'), ((4, 9, 6), 'minecraft:smooth_quartz_slab'), ((4, 9, 7), 'minecraft:smooth_quartz_slab'), ((4, 9, 8), 'minecraft:smooth_quartz_slab'), ((4, 9, 9), 'minecraft:smooth_quartz_slab'), ((4, 9, 10), 'minecraft:smooth_quartz_slab'), ((4, 9, 11), 'minecraft:smooth_quartz_slab'), ((4, 9, 12), 'minecraft:smooth_quartz_slab'), ((4, 9, 13), 'minecraft:white_stained_glass'), ((4, 10, 2), 'minecraft:snow_block'), ((4, 10, 3), 'minecraft:white_stained_glass'), ((4, 10, 13), 'minecraft:white_stained_glass'), ((4, 10, 14), 'minecraft:snow_block'), ((4, 11, 3), 'minecraft:white_stained_glass'), ((4, 11, 13), 'minecraft:white_stained_glass'), ((4, 12, 3), 'minecraft:white_stained_glass'), ((4, 12, 13), 'minecraft:white_stained_glass'), ((4, 13, 3), 'minecraft:white_stained_glass'), ((4, 13, 13), 'minecraft:white_stained_glass'), ((4, 14, 3), 'minecraft:white_stained_glass'), ((4, 14, 7), 'minecraft:soul_soil'), ((4, 14, 9), 'minecraft:soul_soil'), ((4, 14, 13), 'minecraft:white_stained_glass'), ((4, 15, 3), 'minecraft:iron_block'), ((4, 15, 6), 'minecraft:basalt'), ((4, 15, 7), 'minecraft:basalt'), ((4, 15, 8), 'minecraft:blue_ice'), ((4, 15, 9), 'minecraft:basalt'), ((4, 15, 10), 'minecraft:basalt'), ((4, 15, 11), 'minecraft:basalt'), ((4, 15, 13), 'minecraft:iron_block'), ((4, 16, 2), 'minecraft:blue_ice'), ((4, 16, 3), 'minecraft:iron_block'), ((4, 16, 6), 'minecraft:white_stained_glass'), ((4, 16, 7), 'minecraft:lava'), ((4, 16, 8), 'minecraft:white_stained_glass'), ((4, 16, 9), 'minecraft:lava'), ((4, 16, 10), 'minecraft:white_stained_glass'), ((4, 16, 13), 'minecraft:iron_block'), ((4, 16, 14), 'minecraft:blue_ice'), ((4, 17, 2), 'minecraft:white_stained_glass'), ((4, 17, 3), 'minecraft:iron_block'), ((4, 17, 6), 'minecraft:basalt'), ((4, 17, 7), 'minecraft:basalt'), ((4, 17, 8), 'minecraft:white_stained_glass'), ((4, 17, 9), 'minecraft:basalt'), ((4, 17, 10), 'minecraft:basalt'), ((4, 17, 13), 'minecraft:iron_block'), ((4, 17, 14), 'minecraft:white_stained_glass'), ((4, 18, 1), 'minecraft:blue_ice'), ((4, 18, 2), 'minecraft:white_stained_glass'), ((4, 18, 3), 'minecraft:iron_block'), ((4, 18, 6), 'minecraft:white_stained_glass'), ((4, 18, 7), 'minecraft:soul_soil'), ((4, 18, 8), 'minecraft:white_stained_glass'), ((4, 18, 9), 'minecraft:soul_soil'), ((4, 18, 10), 'minecraft:white_stained_glass'), ((4, 18, 13), 'minecraft:iron_block'), ((4, 18, 14), 'minecraft:white_stained_glass'), ((4, 18, 15), 'minecraft:blue_ice'), ((4, 19, 1), 'minecraft:white_stained_glass'), ((4, 19, 2), 'minecraft:white_stained_glass'), ((4, 19, 3), 'minecraft:iron_block'), ((4, 19, 6), 'minecraft:basalt'), ((4, 19, 7), 'minecraft:basalt'), ((4, 19, 8), 'minecraft:blue_ice'), ((4, 19, 9), 'minecraft:basalt'), ((4, 19, 10), 'minecraft:basalt'), ((4, 19, 13), 'minecraft:iron_block'), ((4, 19, 14), 'minecraft:white_stained_glass'), ((4, 19, 15), 'minecraft:white_stained_glass'), ((4, 20, 2), 'minecraft:blue_ice'), ((4, 20, 3), 'minecraft:iron_block'), ((4, 20, 5), 'minecraft:iron_block'), ((4, 20, 6), 'minecraft:white_stained_glass'), ((4, 20, 7), 'minecraft:lava'), ((4, 20, 8), 'minecraft:white_stained_glass'), ((4, 20, 9), 'minecraft:lava'), ((4, 20, 10), 'minecraft:white_stained_glass'), ((4, 20, 11), 'minecraft:iron_block'), ((4, 20, 13), 'minecraft:iron_block'), ((4, 20, 14), 'minecraft:blue_ice'), ((4, 21, 2), 'minecraft:white_stained_glass'), ((4, 21, 3), 'minecraft:white_stained_glass'), ((4, 21, 4), 'minecraft:iron_block'), ((4, 21, 5), 'minecraft:basalt'), ((4, 21, 6), 'minecraft:basalt'), ((4, 21, 7), 'minecraft:piston'), ((4, 21, 8), 'minecraft:white_stained_glass'), ((4, 21, 9), 'minecraft:piston'), ((4, 21, 10), 'minecraft:basalt'), ((4, 21, 11), 'minecraft:basalt'), ((4, 21, 12), 'minecraft:iron_block'), ((4, 21, 13), 'minecraft:white_stained_glass'), ((4, 21, 14), 'minecraft:white_stained_glass'), ((4, 22, 4), 'minecraft:white_stained_glass'), ((4, 22, 5), 'minecraft:white_stained_glass'), ((4, 22, 6), 'minecraft:white_stained_glass'), ((4, 22, 7), 'minecraft:white_stained_glass'), ((4, 22, 8), 'minecraft:snow_block'), ((4, 22, 9), 'minecraft:white_stained_glass'), ((4, 22, 10), 'minecraft:white_stained_glass'), ((4, 22, 11), 'minecraft:white_stained_glass'), ((4, 22, 12), 'minecraft:white_stained_glass'), ((4, 23, 4), 'minecraft:redstone_wire'), ((4, 29, 5), 'minecraft:white_stained_glass'), ((4, 29, 6), 'minecraft:white_stained_glass'), ((4, 30, 5), 'minecraft:comparator'), ((4, 30, 6), 'minecraft:comparator'), ((4, 31, 6), 'minecraft:white_stained_glass'), ((4, 32, 4), 'minecraft:dropper'), ((4, 32, 5), 'minecraft:observer'), ((4, 32, 6), 'minecraft:repeater'), ((4, 32, 7), 'minecraft:snow_block'), ((4, 33, 5), 'minecraft:piston_head'), ((4, 33, 6), 'minecraft:dropper'), ((4, 33, 7), 'minecraft:redstone_torch'), ((4, 33, 8), 'minecraft:sticky_piston'), ((4, 34, 7), 'minecraft:sticky_piston'), ((5, 9, 2), 'minecraft:white_stained_glass'), ((5, 9, 3), 'minecraft:white_stained_glass'), ((5, 9, 4), 'minecraft:iron_trapdoor'), ((5, 9, 5), 'minecraft:iron_trapdoor'), ((5, 9, 6), 'minecraft:iron_trapdoor'), ((5, 9, 7), 'minecraft:iron_trapdoor'), ((5, 9, 8), 'minecraft:iron_trapdoor'), ((5, 9, 9), 'minecraft:iron_trapdoor'), ((5, 9, 10), 'minecraft:iron_trapdoor'), ((5, 9, 11), 'minecraft:iron_trapdoor'), ((5, 9, 12), 'minecraft:iron_trapdoor'), ((5, 9, 13), 'minecraft:white_stained_glass'), ((5, 9, 14), 'minecraft:white_stained_glass'), ((5, 10, 2), 'minecraft:repeater'), ((5, 10, 3), 'minecraft:white_stained_glass'), ((5, 10, 13), 'minecraft:white_stained_glass'), ((5, 10, 14), 'minecraft:repeater'), ((5, 11, 3), 'minecraft:white_stained_glass'), ((5, 11, 13), 'minecraft:white_stained_glass'), ((5, 12, 3), 'minecraft:white_stained_glass'), ((5, 12, 13), 'minecraft:white_stained_glass'), ((5, 13, 3), 'minecraft:white_stained_glass'), ((5, 13, 13), 'minecraft:white_stained_glass'), ((5, 14, 3), 'minecraft:white_stained_glass'), ((5, 14, 13), 'minecraft:white_stained_glass'), ((5, 15, 2), 'minecraft:soul_soil'), ((5, 15, 3), 'minecraft:iron_block'), ((5, 15, 7), 'minecraft:basalt'), ((5, 15, 9), 'minecraft:basalt'), ((5, 15, 13), 'minecraft:iron_block'), ((5, 15, 14), 'minecraft:soul_soil'), ((5, 16, 1), 'minecraft:piston'), ((5, 16, 2), 'minecraft:basalt'), ((5, 16, 3), 'minecraft:basalt'), ((5, 16, 7), 'minecraft:white_stained_glass'), ((5, 16, 9), 'minecraft:white_stained_glass'), ((5, 16, 13), 'minecraft:basalt'), ((5, 16, 14), 'minecraft:basalt'), ((5, 16, 15), 'minecraft:piston'), ((5, 17, 1), 'minecraft:soul_soil'), ((5, 17, 2), 'minecraft:lava'), ((5, 17, 3), 'minecraft:iron_block'), ((5, 17, 7), 'minecraft:basalt'), ((5, 17, 9), 'minecraft:basalt'), ((5, 17, 13), 'minecraft:iron_block'), ((5, 17, 14), 'minecraft:lava'), ((5, 17, 15), 'minecraft:soul_soil'), ((5, 18, 0), 'minecraft:piston'), ((5, 18, 1), 'minecraft:basalt'), ((5, 18, 2), 'minecraft:basalt'), ((5, 18, 3), 'minecraft:basalt'), ((5, 18, 7), 'minecraft:white_stained_glass'), ((5, 18, 9), 'minecraft:white_stained_glass'), ((5, 18, 13), 'minecraft:basalt'), ((5, 18, 14), 'minecraft:basalt'), ((5, 18, 15), 'minecraft:basalt'), ((5, 18, 16), 'minecraft:piston'), ((5, 19, 0), 'minecraft:white_stained_glass'), ((5, 19, 1), 'minecraft:lava'), ((5, 19, 2), 'minecraft:soul_soil'), ((5, 19, 3), 'minecraft:iron_block'), ((5, 19, 7), 'minecraft:basalt'), ((5, 19, 9), 'minecraft:basalt'), ((5, 19, 13), 'minecraft:iron_block'), ((5, 19, 14), 'minecraft:soul_soil'), ((5, 19, 15), 'minecraft:lava'), ((5, 19, 16), 'minecraft:white_stained_glass'), ((5, 20, 1), 'minecraft:piston'), ((5, 20, 2), 'minecraft:basalt'), ((5, 20, 3), 'minecraft:basalt'), ((5, 20, 7), 'minecraft:soul_soil'), ((5, 20, 8), 'minecraft:white_stained_glass'), ((5, 20, 9), 'minecraft:soul_soil'), ((5, 20, 13), 'minecraft:basalt'), ((5, 20, 14), 'minecraft:basalt'), ((5, 20, 15), 'minecraft:piston'), ((5, 21, 1), 'minecraft:white_stained_glass'), ((5, 21, 2), 'minecraft:lava'), ((5, 21, 3), 'minecraft:white_stained_glass'), ((5, 21, 6), 'minecraft:basalt'), ((5, 21, 7), 'minecraft:basalt'), ((5, 21, 8), 'minecraft:blue_ice'), ((5, 21, 9), 'minecraft:basalt'), ((5, 21, 11), 'minecraft:basalt'), ((5, 21, 13), 'minecraft:white_stained_glass'), ((5, 21, 14), 'minecraft:lava'), ((5, 21, 15), 'minecraft:white_stained_glass'), ((5, 22, 4), 'minecraft:blue_ice'), ((5, 22, 5), 'minecraft:iron_block'), ((5, 22, 6), 'minecraft:iron_block'), ((5, 22, 7), 'minecraft:lava'), ((5, 22, 8), 'minecraft:white_stained_glass'), ((5, 22, 9), 'minecraft:lava'), ((5, 22, 10), 'minecraft:iron_block'), ((5, 22, 11), 'minecraft:iron_block'), ((5, 22, 12), 'minecraft:blue_ice'), ((5, 23, 4), 'minecraft:snow_block'), ((5, 23, 5), 'minecraft:white_stained_glass'), ((5, 23, 6), 'minecraft:white_stained_glass'), ((5, 23, 7), 'minecraft:white_stained_glass'), ((5, 23, 8), 'minecraft:white_stained_glass'), ((5, 23, 9), 'minecraft:white_stained_glass'), ((5, 23, 10), 'minecraft:white_stained_glass'), ((5, 23, 11), 'minecraft:white_stained_glass'), ((5, 23, 12), 'minecraft:white_stained_glass'), ((5, 24, 4), 'minecraft:redstone_wire'), ((5, 24, 5), 'minecraft:redstone_wire'), ((5, 29, 5), 'minecraft:white_stained_glass'), ((5, 30, 5), 'minecraft:redstone_wire'), ((5, 30, 6), 'minecraft:snow_block'), ((5, 31, 5), 'minecraft:redstone_wall_torch'), ((5, 32, 5), 'minecraft:snow_block'), ((5, 33, 5), 'minecraft:sticky_piston'), ((5, 33, 8), 'minecraft:piston_head'), ((5, 34, 7), 'minecraft:piston_head'), ((6, 2, 9), 'minecraft:white_glazed_terracotta'), ((6, 3, 9), 'minecraft:sticky_piston'), ((6, 4, 5), 'minecraft:note_block'), ((6, 4, 6), 'minecraft:observer'), ((6, 4, 7), 'minecraft:note_block'), ((6, 4, 8), 'minecraft:observer'), ((6, 4, 9), 'minecraft:note_block'), ((6, 8, 3), 'minecraft:white_stained_glass'), ((6, 8, 4), 'minecraft:white_stained_glass'), ((6, 8, 5), 'minecraft:white_stained_glass'), ((6, 8, 6), 'minecraft:white_stained_glass'), ((6, 8, 7), 'minecraft:white_stained_glass'), ((6, 8, 8), 'minecraft:white_stained_glass'), ((6, 8, 9), 'minecraft:white_stained_glass'), ((6, 8, 10), 'minecraft:white_stained_glass'), ((6, 8, 11), 'minecraft:white_stained_glass'), ((6, 8, 12), 'minecraft:white_stained_glass'), ((6, 8, 13), 'minecraft:white_stained_glass'), ((6, 9, 3), 'minecraft:white_stained_glass'), ((6, 9, 4), 'minecraft:light_blue_carpet'), ((6, 9, 5), 'minecraft:light_blue_carpet'), ((6, 9, 6), 'minecraft:light_blue_carpet'), ((6, 9, 7), 'minecraft:light_blue_carpet'), ((6, 9, 8), 'minecraft:light_blue_carpet'), ((6, 9, 9), 'minecraft:light_blue_carpet'), ((6, 9, 10), 'minecraft:light_blue_carpet'), ((6, 9, 11), 'minecraft:light_blue_carpet'), ((6, 9, 12), 'minecraft:light_blue_carpet'), ((6, 9, 13), 'minecraft:white_stained_glass'), ((6, 10, 2), 'minecraft:snow_block'), ((6, 10, 3), 'minecraft:white_stained_glass'), ((6, 10, 13), 'minecraft:white_stained_glass'), ((6, 10, 14), 'minecraft:snow_block'), ((6, 11, 3), 'minecraft:white_stained_glass'), ((6, 11, 13), 'minecraft:white_stained_glass'), ((6, 12, 3), 'minecraft:white_stained_glass'), ((6, 12, 13), 'minecraft:white_stained_glass'), ((6, 13, 3), 'minecraft:white_stained_glass'), ((6, 13, 13), 'minecraft:white_stained_glass'), ((6, 14, 3), 'minecraft:white_stained_glass'), ((6, 14, 13), 'minecraft:white_stained_glass'), ((6, 15, 2), 'minecraft:soul_soil'), ((6, 15, 3), 'minecraft:white_stained_glass'), ((6, 15, 13), 'minecraft:white_stained_glass'), ((6, 15, 14), 'minecraft:soul_soil'), ((6, 16, 1), 'minecraft:piston'), ((6, 16, 2), 'minecraft:basalt'), ((6, 16, 3), 'minecraft:basalt'), ((6, 16, 4), 'minecraft:basalt'), ((6, 16, 12), 'minecraft:basalt'), ((6, 16, 13), 'minecraft:basalt'), ((6, 16, 14), 'minecraft:basalt'), ((6, 16, 15), 'minecraft:piston'), ((6, 17, 1), 'minecraft:soul_soil'), ((6, 17, 2), 'minecraft:lava'), ((6, 17, 3), 'minecraft:white_stained_glass'), ((6, 17, 4), 'minecraft:white_stained_glass'), ((6, 17, 12), 'minecraft:white_stained_glass'), ((6, 17, 13), 'minecraft:white_stained_glass'), ((6, 17, 14), 'minecraft:lava'), ((6, 17, 15), 'minecraft:soul_soil'), ((6, 18, 0), 'minecraft:piston'), ((6, 18, 1), 'minecraft:basalt'), ((6, 18, 2), 'minecraft:basalt'), ((6, 18, 3), 'minecraft:basalt'), ((6, 18, 4), 'minecraft:basalt'), ((6, 18, 12), 'minecraft:basalt'), ((6, 18, 13), 'minecraft:basalt'), ((6, 18, 14), 'minecraft:basalt'), ((6, 18, 15), 'minecraft:basalt'), ((6, 18, 16), 'minecraft:piston'), ((6, 19, 0), 'minecraft:snow_block'), ((6, 19, 1), 'minecraft:lava'), ((6, 19, 2), 'minecraft:soul_soil'), ((6, 19, 3), 'minecraft:white_stained_glass'), ((6, 19, 4), 'minecraft:white_stained_glass'), ((6, 19, 12), 'minecraft:white_stained_glass'), ((6, 19, 13), 'minecraft:white_stained_glass'), ((6, 19, 14), 'minecraft:soul_soil'), ((6, 19, 15), 'minecraft:lava'), ((6, 19, 16), 'minecraft:snow_block'), ((6, 20, 1), 'minecraft:piston'), ((6, 20, 2), 'minecraft:basalt'), ((6, 20, 3), 'minecraft:basalt'), ((6, 20, 4), 'minecraft:basalt'), ((6, 20, 12), 'minecraft:basalt'), ((6, 20, 13), 'minecraft:basalt'), ((6, 20, 14), 'minecraft:basalt'), ((6, 20, 15), 'minecraft:piston'), ((6, 21, 1), 'minecraft:snow_block'), ((6, 21, 2), 'minecraft:lava'), ((6, 21, 3), 'minecraft:white_stained_glass'), ((6, 21, 4), 'minecraft:soul_soil'), ((6, 21, 7), 'minecraft:basalt'), ((6, 21, 9), 'minecraft:basalt'), ((6, 21, 11), 'minecraft:basalt'), ((6, 21, 12), 'minecraft:soul_soil'), ((6, 21, 13), 'minecraft:white_stained_glass'), ((6, 21, 14), 'minecraft:lava'), ((6, 21, 15), 'minecraft:snow_block'), ((6, 22, 3), 'minecraft:piston'), ((6, 22, 4), 'minecraft:basalt'), ((6, 22, 5), 'minecraft:basalt'), ((6, 22, 6), 'minecraft:basalt'), ((6, 22, 7), 'minecraft:white_stained_glass'), ((6, 22, 8), 'minecraft:crying_obsidian'), ((6, 22, 9), 'minecraft:white_stained_glass'), ((6, 22, 10), 'minecraft:basalt'), ((6, 22, 11), 'minecraft:basalt'), ((6, 22, 12), 'minecraft:basalt'), ((6, 22, 13), 'minecraft:piston'), ((6, 23, 3), 'minecraft:white_stained_glass'), ((6, 23, 4), 'minecraft:lava'), ((6, 23, 5), 'minecraft:white_stained_glass'), ((6, 23, 6), 'minecraft:iron_block'), ((6, 23, 7), 'minecraft:white_stained_glass'), ((6, 23, 8), 'minecraft:white_stained_glass'), ((6, 23, 9), 'minecraft:white_stained_glass'), ((6, 23, 10), 'minecraft:iron_block'), ((6, 23, 11), 'minecraft:white_stained_glass'), ((6, 23, 12), 'minecraft:lava'), ((6, 23, 13), 'minecraft:white_stained_glass'), ((6, 24, 5), 'minecraft:redstone_wire'), ((6, 24, 6), 'minecraft:redstone_wire'), ((6, 26, 6), 'minecraft:redstone_block'), ((6, 27, 6), 'minecraft:sticky_piston')]
blocks = [((0,0,0), 'minecraft:dirt', None), ((0,0,1), 'minecraft:grass_block', None),( (0,1,0), 'minecraft:lava', None), ((1,0,0), 'minecraft:glass', None)]
xl:int
yl:int
zl:int
data = json.load(open(grs(os.path.join('lang', 'data.json')), 'r', encoding='utf-8'))
color_map = data["Color_map"][data["Save"]["ui"]["ColorMap"]]
def draw_cube(position, color, face:tuple, mode:int):
    """
    绘制一个立方体
    :param mode: 0Full 1Half 2Carpet 3
    :param face:
    :param position: 方块的原点位置 (x, y, z)
    :param color: 方块的颜色 (R, G, B)
    """
    x, y, z = position
    x, y, z = (x - (xl / 2))/10, (y - (yl / 2))/10, (z - (zl / 2))/10
    vertices = np.array([[[x, y, z],
          [x + 0.1, y, z],
          [x + 0.1, y + 0.1, z],
          [x, y + 0.1, z],
          [x, y, z + 0.1],
          [x + 0.1, y, z + 0.1],
          [x + 0.1, y + 0.1, z + 0.1],
          [x, y + 0.1, z + 0.1]],
          [[x, y, z],
           [x + 0.1, y, z],
           [x + 0.1, y + 0.05, z],
           [x, y + 0.05, z],
           [x, y, z + 0.1],
           [x + 0.1, y, z + 0.1],
           [x + 0.1, y + 0.05, z + 0.1],
           [x, y + 0.05, z + 0.1]],
          [[x + 0.05 , y , z],
          [x + 0.05, y + 0.1, z],
          [x + 0.05, y, z + 0.1],
          [x + 0.05, y + 0.1, z + 0.1],
          [x + 0.05 , y , z],
          [x + 0.05, y + 0.1, z],
          [x + 0.05, y, z + 0.1],
          [x + 0.05, y + 0.1, z + 0.1]]
    ])

    surfaces = [
        (4, 0, 3, 7),
        (1, 5, 6, 2),
        (3, 2, 6, 7),
        (4, 5, 1, 0),
        (7, 6, 5, 4),
        (0, 1, 2, 3),
    ] # LR UD FB
    glColor3fv(color)
    glBegin(GL_QUADS)
    for i, is_enabled in enumerate(face):
        if is_enabled:
            if mode == 2:
                for vertex in (4, 5, 1, 0):
                    glVertex3fv(vertices[0,vertex])
            elif mode == 3:
                for vertex in range(4):
                    glVertex3fv(vertices[2,vertex])
            else:
                for vertex in surfaces[i]:
                    glVertex3fv(vertices[mode,vertex])
    glEnd()

def CCrgb(image_path):
    with Image.open(image_path) as img:
        img = img.convert("RGB")
        img_array = np.array(img)[2:-2:2,2:-2:4]
        pixels = img_array.reshape(-1, 3)
        color_counts = Counter(map(tuple, pixels))
        color_counts[(0, 0, 0)]=0
        color_counts[(255, 255, 255)] = 0
        most_common_color = color_counts.most_common(1)[0][0]
        normalized_color = tuple(color / 255.0 for color in most_common_color)
        return normalized_color

def render_world(blocks, rotation_angle):
    """
    渲染整个世界
    :param blocks: 方块数据 [((x, y, z), id), ...]
    :param rotation_angle: 当前旋转角度
    """
    glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)
    glLoadIdentity()
    gluLookAt(3, 3, 3, 0, 0, 0, 0, 1, 0) # 设置相机位置和方向 | ? 偏差 角度
    glRotatef(-rotation_angle, 0, 1, 0) # 逆时针旋转
    for x,_ in enumerate(blocks):
        for y,_ in enumerate(blocks[x]):
            for z,_ in enumerate(blocks[x][y]):
                if not blocks[x][y][z] or blocks[x][y][z]=='minecraft:tripwire':
                    continue
                elif not x or not y or not z or x==xl or y==yl or z==zl:
                    fu: bool = False
                    pass
                else:
                    fu = isinstance(blocks[x][y + 1][z], str)
                    if isinstance(blocks[x + 1][y][z], str) and isinstance(blocks[x - 1][y][z], str) and fu and isinstance(blocks[x][y][z + 1], str) and isinstance(blocks[x][y][z - 1], str):
                        blocks[x][y][z] = None
                        continue

                mode = 1 if "slab" in str(blocks[x][y][z]) else 2 if "carpet" in str(blocks[x][y][z]) else 3 if "pane" in str(blocks[x][y][z]) else 0

                try:
                    color = CCrgb(grs(os.path.join('block', f"{blocks[x][y][z].split(':')[1]}.png")))
                    #print(color, blocks[x][y][z])
                    if color == (0.0,0.0,0.0):
                        color = CCrgb(grs(os.path.join('item', f"{blocks[x][y][z].split(':')[1]}.png")))
                        mode = 2
                except FileNotFoundError as e:
                    color = (100,100,100)
                    #print(f"error:{e}")
                s = (True,True,not fu,False,True,True)
                draw_cube((x,y,z), color,s,mode)

def init_opengl(display):
    glEnable(GL_DEPTH_TEST)  # 启用深度测试
    glClearColor(int(color_map["MC"][1:3], 16)/255.0, int(color_map["MC"][3:5], 16)/255.0, int(color_map["MC"][5:7], 16)/255.0, 1.0)  # 设置背景颜色
    glMatrixMode(GL_PROJECTION)
    gluPerspective(45, (display[0] / display[1]), 0.1, 50.0)  # 设置透视投影
    glMatrixMode(GL_MODELVIEW)

class OpenGLView(OpenGLFrame):
    def __init__(self, parent, blocks : list[tuple[tuple,str,list]], rotate=True, **kwargs):
        super().__init__(parent, **kwargs)
        self.blocks = blocks
        self.rotate = rotate
        self.rotation_angle = 0
        self.rotation_speed = 300
        self.width = 300
        self.height = 300

        # 初始化方块位置数据
        global xl, yl, zl
        xl = max([x for (x, _, _), _, _ in blocks])
        yl = max([y for (_, y, _), _, _ in blocks])
        zl = max([z for (_, _, z), _, _ in blocks])
        print((xl,yl,zl))
        self.zoom = max(xl,yl,zl)+5
        self.pos_blocks = [[[None] * (zl + 1) for _ in range(yl + 1)] for _ in range(xl + 1)]
        for position, block_id, block_prop in blocks:
            x, y, z = position
            self.pos_blocks[x][y][z] = block_id

    def initgl(self):
        glEnable(GL_DEPTH_TEST)
        glClearColor(int(color_map["MC"][1:3], 16)/255.0, int(color_map["MC"][3:5], 16)/255.0, int(color_map["MC"][5:7], 16)/255.0, 1.0)
        self.set_projection()

    def set_projection(self):
        glMatrixMode(GL_PROJECTION)
        glLoadIdentity()
        gluPerspective(self.zoom, (self.width / self.height), 0.1, 50.0)
        glMatrixMode(GL_MODELVIEW)

    def redraw(self):
        if self.rotate:
            self.rotation_angle = (self.rotation_angle + 1) % 360
        self.tkMakeCurrent()
        self.paintgl()
        self.tkSwapBuffers()
        self.after(2000, self.redraw)  # 控制渲染频率

    def paintgl(self):
        glClear(GL_COLOR_BUFFER_BIT | GL_DEPTH_BUFFER_BIT)
        glLoadIdentity()
        gluLookAt(3, 3, 5, 0.5, 0.5, 0.5, 0, 1, 0)
        glRotatef(-self.rotation_angle, 0, 1, 0)

        # 调用原有的渲染逻辑
        render_world(self.pos_blocks, self.rotation_angle)

    def resize(self, width, height):
        self.width = width
        self.height = height
        self.tkMakeCurrent()
        glViewport(0, 0, width, height)
        self.set_projection()
        self.tkSwapBuffers()

def main_render_loop(blocks, rotate):
    rootr = tk.Tk()
    rootr.title("OpenGL Render")
    rootr.iconbitmap(grs("icon.ico"))
    gl_view = OpenGLView(rootr, blocks, rotate, width=300, height=300)
    gl_view.pack(fill=tk.BOTH, expand=True)
    gl_view.after(2000, gl_view.redraw)
    rootr.mainloop()




if __name__ == "__main__":
    main_render_loop(blocks, True)