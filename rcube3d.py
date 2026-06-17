import sys, math, pygame
from pygame.locals import *

from cube_engine import Cube
import solver

# --- Color definitions (RGB) ---
color_map = {
    'U': (255, 255, 255),  # white
    'D': (255, 255, 0),    # yellow
    'F': (0, 255, 0),      # green
    'B': (0, 0, 255),      # blue
    'L': (255, 165, 0),    # orange
    'R': (255, 0, 0)       # red
}

# --- 3D rotation & projection functions (manual math) ---
def rotate_point(p, rot_x, rot_y):
    x, y, z = p
    rx = math.radians(rot_x)
    ry = math.radians(rot_y)
    # Rotate about the X-axis
    y, z = y * math.cos(rx) - z * math.sin(rx), y * math.sin(rx) + z * math.cos(rx)
    # Then rotate about the Y-axis
    x, z = x * math.cos(ry) + z * math.sin(ry), -x * math.sin(ry) + z * math.cos(ry)
    return (x, y, z)

def project_point(p, screen_width, screen_height, fov, viewer_distance):
    x, y, z = p
    factor = fov / (z + viewer_distance) if (z + viewer_distance) != 0 else fov
    x_proj = x * factor + screen_width / 2
    y_proj = -y * factor + screen_height / 2
    return (int(x_proj), int(y_proj))

# --- Build polygons for each face (using painter's algorithm) ---
def get_face_polygons(face_matrix, n, center, right_vec, up_vec, rot_x, rot_y, screen_width, screen_height, fov, viewer_distance):
    polys = []
    cell_size = 2.0 / n  # each cube face spans 2 units
    for i in range(n):
        for j in range(n):
            left = -1 + j * cell_size
            right_edge = -1 + (j+1) * cell_size
            top = 1 - i * cell_size
            bottom = 1 - (i+1) * cell_size
            def local_to_world(local_x, local_y):
                return (center[0] + local_x * right_vec[0] + local_y * up_vec[0],
                        center[1] + local_x * right_vec[1] + local_y * up_vec[1],
                        center[2] + local_x * right_vec[2] + local_y * up_vec[2])
            tl = local_to_world(left, top)
            tr = local_to_world(right_edge, top)
            br = local_to_world(right_edge, bottom)
            bl = local_to_world(left, bottom)
            rtl = rotate_point(tl, rot_x, rot_y)
            rtr = rotate_point(tr, rot_x, rot_y)
            rbr = rotate_point(br, rot_x, rot_y)
            rbl = rotate_point(bl, rot_x, rot_y)
            avg_z = (rtl[2] + rtr[2] + rbr[2] + rbl[2]) / 4.0
            ptl = project_point(rtl, screen_width, screen_height, fov, viewer_distance)
            ptr = project_point(rtr, screen_width, screen_height, fov, viewer_distance)
            pbr = project_point(rbr, screen_width, screen_height, fov, viewer_distance)
            pbl = project_point(rbl, screen_width, screen_height, fov, viewer_distance)
            col_letter = face_matrix[i][j]
            col = color_map.get(col_letter, (0, 0, 0))
            polys.append((avg_z, [ptl, ptr, pbr, pbl], col))
    return polys

def accumulate_all_polygons(cube, rot_x, rot_y, screen_width, screen_height, fov, viewer_distance):
    polys = []
    n = cube.n
    # Define face centers and local axes:
    polys.extend(get_face_polygons(cube.faces['F'], n, (0,0,1), (1,0,0), (0,1,0), rot_x, rot_y, screen_width, screen_height, fov, viewer_distance))
    polys.extend(get_face_polygons(cube.faces['B'], n, (0,0,-1), (-1,0,0), (0,1,0), rot_x, rot_y, screen_width, screen_height, fov, viewer_distance))
    polys.extend(get_face_polygons(cube.faces['U'], n, (0,1,0), (1,0,0), (0,0,-1), rot_x, rot_y, screen_width, screen_height, fov, viewer_distance))
    polys.extend(get_face_polygons(cube.faces['D'], n, (0,-1,0), (1,0,0), (0,0,1), rot_x, rot_y, screen_width, screen_height, fov, viewer_distance))
    polys.extend(get_face_polygons(cube.faces['L'], n, (-1,0,0), (0,0,1), (0,1,0), rot_x, rot_y, screen_width, screen_height, fov, viewer_distance))
    polys.extend(get_face_polygons(cube.faces['R'], n, (1,0,0), (0,0,-1), (0,1,0), rot_x, rot_y, screen_width, screen_height, fov, viewer_distance))
    return polys

# --- Main program ---
def main():
    pygame.init()
    screen_width, screen_height = 3840, 2160  # 4K UHD
    screen = pygame.display.set_mode((screen_width, screen_height))
    pygame.display.set_caption("3D Rubik's Cube Emulator (Pygame Only)")
    clock = pygame.time.Clock()

    # Perspective settings, scaled up from the original 800x600 baseline so
    # the cube occupies the same fraction of the screen at 4K.
    scale = screen_width / 800
    fov = 256 * scale
    viewer_distance = 4

    cube_dim = 3
    cube = Cube(cube_dim)

    # Default camera parameters
    default_rot_x, default_rot_y = 25, -30
    default_viewer_distance = 4
    rot_x, rot_y = default_rot_x, default_rot_y

    # Mouse control flags
    rotating = False    # left-click drag rotates view (inverted)
    zooming = False     # middle-click drag adjusts zoom
    face_drag = False   # right-click drag rotates front face
    last_mouse_pos = (0, 0)
    zoom_start_dist = viewer_distance
    face_drag_start = None
    face_drag_threshold = 30 * scale  # pixels
    
    running = True
    while running:
        for event in pygame.event.get():
            if event.type == QUIT:
                running = False
            
            elif event.type == MOUSEBUTTONDOWN:
                if event.button == 1:  # left click: rotate view (inverted)
                    rotating = True
                    last_mouse_pos = event.pos
                elif event.button == 2:  # middle click: zoom control
                    zooming = True
                    last_mouse_pos = event.pos
                    zoom_start_dist = viewer_distance
                elif event.button == 3:  # right click: face rotation (F move)
                    face_drag = True
                    face_drag_start = event.pos
                elif event.button == 4:  # scroll up: increase cube dimension
                    cube_dim += 1
                    cube = Cube(cube_dim)
                    print("\nCube dimension increased to", cube_dim)
                    cube.print_cube()
                elif event.button == 5:  # scroll down: decrease cube dimension (min 2)
                    if cube_dim > 2:
                        cube_dim -= 1
                        cube = Cube(cube_dim)
                        print("\nCube dimension decreased to", cube_dim)
                        cube.print_cube()
            
            elif event.type == MOUSEBUTTONUP:
                if event.button == 1:
                    rotating = False
                elif event.button == 2:
                    zooming = False
                elif event.button == 3:
                    if face_drag and face_drag_start:
                        dx = event.pos[0] - face_drag_start[0]
                        mods = pygame.key.get_mods()
                        if abs(dx) > face_drag_threshold:
                            if dx > 0:
                                move = "F'" if (mods & KMOD_SHIFT) else "F"
                            else:
                                move = "F" if (mods & KMOD_SHIFT) else "F'"
                            cube.apply_move(move)
                            print(f"\nPerformed face drag move: {move}")
                            cube.print_cube(move)
                    face_drag = False
                    face_drag_start = None
            
            elif event.type == MOUSEMOTION:
                if rotating:
                    dx = event.pos[0] - last_mouse_pos[0]
                    dy = event.pos[1] - last_mouse_pos[1]
                    # Invert the control: subtract instead of add.
                    rot_y -= dx * 0.5
                    rot_x -= dy * 0.5
                    last_mouse_pos = event.pos
                if zooming:
                    dy = event.pos[1] - last_mouse_pos[1]
                    viewer_distance = max(1, zoom_start_dist + dy * 0.02)
            
            elif event.type == KEYDOWN:
                mods = pygame.key.get_mods()
                move = ""
                if event.key == K_w:
                    rot_x, rot_y = default_rot_x, default_rot_y
                    viewer_distance = default_viewer_distance
                    print("\nCamera orientation reset.")
                elif event.key == K_u:
                    move = "U'" if (mods & KMOD_SHIFT) else "U"
                elif event.key == K_d:
                    move = "D'" if (mods & KMOD_SHIFT) else "D"
                elif event.key == K_f:
                    move = "F'" if (mods & KMOD_SHIFT) else "F"
                elif event.key == K_b:
                    move = "B'" if (mods & KMOD_SHIFT) else "B"
                elif event.key == K_l:
                    move = "L'" if (mods & KMOD_SHIFT) else "L"
                elif event.key == K_r:
                    move = "R'" if (mods & KMOD_SHIFT) else "R"
                elif event.key == K_m:
                    move = "M'" if (mods & KMOD_SHIFT) else "M"
                elif event.key == K_e:
                    move = "E'" if (mods & KMOD_SHIFT) else "E"
                elif event.key == K_s:
                    move = "S'" if (mods & KMOD_SHIFT) else "S"
                elif event.key == K_SPACE:
                    seq = solver.scramble(cube)
                    print(f"\nScrambled with {len(seq)} moves: {' '.join(seq)}")
                    cube.print_cube()
                elif event.key == K_RETURN:
                    if cube_dim == 3:
                        sol = solver.solve(cube)
                        print(f"\nSolved in {len(sol)} moves: {' '.join(sol)}")
                        cube.print_cube()
                    else:
                        print("\nSolver only supports 3x3x3 cubes.")

                if move:
                    if move[0] in ('M', 'E', 'S') and cube_dim % 2 == 0:
                        print(f"\n{move[0]} moves require an odd-sized cube (current size {cube_dim}).")
                    else:
                        cube.apply_move(move)
                        cube.print_cube(move)
        
        # --- Rendering ---
        screen.fill((50, 50, 50))
        polygons = accumulate_all_polygons(cube, rot_x, rot_y, screen_width, screen_height, fov, viewer_distance)
        # Painter's algorithm: sort polygons by average depth (furthest first)
        polygons.sort(key=lambda poly: poly[0], reverse=True)
        for _, pts, col in polygons:
            pygame.draw.polygon(screen, col, pts)
            pygame.draw.polygon(screen, (0, 0, 0), pts, 1)
        
        pygame.display.flip()
        clock.tick(30)
    
    pygame.quit()
    sys.exit()

if __name__ == '__main__':
    main()
