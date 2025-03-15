import sys, math, pygame
from pygame.locals import *

# --- Color definitions (RGB) ---
color_map = {
    'U': (255, 255, 255),  # white
    'D': (255, 255, 0),    # yellow
    'F': (0, 255, 0),      # green
    'B': (0, 0, 255),      # blue
    'L': (255, 165, 0),    # orange
    'R': (255, 0, 0)       # red
}

# --- Helper: Rotate a matrix clockwise ---
def rotate_matrix_clockwise(mat):
    return [list(row) for row in zip(*mat[::-1])]

# --- Cube state class ---
class Cube:
    def __init__(self, n):
        self.n = n
        # Each face is stored as an n×n matrix with its identifying letter.
        self.faces = {
            'U': [[ 'U' for _ in range(n)] for _ in range(n)],
            'D': [[ 'D' for _ in range(n)] for _ in range(n)],
            'F': [[ 'F' for _ in range(n)] for _ in range(n)],
            'B': [[ 'B' for _ in range(n)] for _ in range(n)],
            'L': [[ 'L' for _ in range(n)] for _ in range(n)],
            'R': [[ 'R' for _ in range(n)] for _ in range(n)]
        }
    
    def print_cube(self, move=""):
        if move:
            print(f"\nPerformed move: {move}")
        else:
            print("\nCube state:")
        for face in ['U', 'D', 'F', 'B', 'L', 'R']:
            print(f"{face} face:")
            for row in self.faces[face]:
                print("  " + " ".join(row))
        print("-" * 30)
    
    # --- Standard face moves (clockwise) ---
    # Front move: when looking directly at F, a clockwise turn
    def move_F(self):
        n = self.n
        self.faces['F'] = rotate_matrix_clockwise(self.faces['F'])
        temp = self.faces['U'][n-1][:]
        # U bottom row becomes reversed L right column
        self.faces['U'][n-1] = list(reversed([self.faces['L'][i][n-1] for i in range(n)]))
        # L right column becomes D top row
        for i in range(n):
            self.faces['L'][i][n-1] = self.faces['D'][0][i]
        # D top row becomes reversed R left column
        self.faces['D'][0] = list(reversed([self.faces['R'][i][0] for i in range(n)]))
        # R left column becomes temp (unchanged order)
        for i in range(n):
            self.faces['R'][i][0] = temp[i]
    
    # Back move: when looking from the back, a clockwise turn on B
    def move_B(self):
        n = self.n
        self.faces['B'] = rotate_matrix_clockwise(self.faces['B'])
        temp = self.faces['U'][0][:]
        # U top row becomes reversed R right column
        self.faces['U'][0] = list(reversed([self.faces['R'][i][n-1] for i in range(n)]))
        # R right column becomes D bottom row
        for i in range(n):
            self.faces['R'][i][n-1] = self.faces['D'][n-1][i]
        # D bottom row becomes reversed L left column
        self.faces['D'][n-1] = list(reversed([self.faces['L'][i][0] for i in range(n)]))
        # L left column becomes temp
        for i in range(n):
            self.faces['L'][i][0] = temp[i]
    
    # Left move: when looking at the cube, L face turns clockwise
    def move_L(self):
        n = self.n
        self.faces['L'] = rotate_matrix_clockwise(self.faces['L'])
        temp = [self.faces['U'][i][0] for i in range(n)]
        for i in range(n):
            self.faces['U'][i][0] = self.faces['B'][n-1-i][n-1]
        for i in range(n):
            self.faces['B'][n-1-i][n-1] = self.faces['D'][i][0]
        for i in range(n):
            self.faces['D'][i][0] = self.faces['F'][i][0]
        for i in range(n):
            self.faces['F'][i][0] = temp[i]
    
    # Right move: when looking at the cube, R face turns clockwise
    def move_R(self):
        n = self.n
        self.faces['R'] = rotate_matrix_clockwise(self.faces['R'])
        temp = [self.faces['U'][i][n-1] for i in range(n)]
        for i in range(n):
            self.faces['U'][i][n-1] = self.faces['F'][i][n-1]
        for i in range(n):
            self.faces['F'][i][n-1] = self.faces['D'][i][n-1]
        for i in range(n):
            self.faces['D'][i][n-1] = self.faces['B'][n-1-i][0]
        for i in range(n):
            self.faces['B'][n-1-i][0] = temp[i]
    
    def move_U(self):
        n = self.n
        self.faces['U'] = rotate_matrix_clockwise(self.faces['U'])
        temp = self.faces['F'][0][:]
        self.faces['F'][0] = self.faces['R'][0][:]
        self.faces['R'][0] = self.faces['B'][0][:]
        self.faces['B'][0] = self.faces['L'][0][:]
        self.faces['L'][0] = temp
    
    def move_D(self):
        n = self.n
        self.faces['D'] = rotate_matrix_clockwise(self.faces['D'])
        temp = self.faces['F'][n-1][:]
        self.faces['F'][n-1] = self.faces['L'][n-1][:]
        self.faces['L'][n-1] = self.faces['B'][n-1][:]
        self.faces['B'][n-1] = self.faces['R'][n-1][:]
        self.faces['R'][n-1] = temp

    # --- Inverse moves (counterclockwise): three clockwise moves ---
    def move_F_cc(self):
        for _ in range(3): self.move_F()
    def move_B_cc(self):
        for _ in range(3): self.move_B()
    def move_L_cc(self):
        for _ in range(3): self.move_L()
    def move_R_cc(self):
        for _ in range(3): self.move_R()
    def move_U_cc(self):
        for _ in range(3): self.move_U()
    def move_D_cc(self):
        for _ in range(3): self.move_D()
    
    # --- Additional moves for 3x3 only ---
    # M move: rotates the middle vertical slice (affects U, F, D, B)
    def move_M(self):
        m = self.n // 2
        for i in range(self.n):
            temp = self.faces['U'][i][m]
            self.faces['U'][i][m] = self.faces['F'][i][m]
            self.faces['F'][i][m] = self.faces['D'][i][m]
            self.faces['D'][i][m] = self.faces['B'][i][m]
            self.faces['B'][i][m] = temp

    def move_M_cc(self):
        m = self.n // 2
        for i in range(self.n):
            temp = self.faces['U'][i][m]
            self.faces['U'][i][m] = self.faces['B'][i][m]
            self.faces['B'][i][m] = self.faces['D'][i][m]
            self.faces['D'][i][m] = self.faces['F'][i][m]
            self.faces['F'][i][m] = temp

    # E move: rotates the equatorial (middle horizontal) layer (affects F, R, B, L)
    def move_E(self):
        m = self.n // 2
        temp = self.faces['F'][m][:]
        self.faces['F'][m] = self.faces['R'][m][:]
        self.faces['R'][m] = self.faces['B'][m][:]
        self.faces['B'][m] = self.faces['L'][m][:]
        self.faces['L'][m] = temp

    def move_E_cc(self):
        m = self.n // 2
        temp = self.faces['F'][m][:]
        self.faces['F'][m] = self.faces['L'][m][:]
        self.faces['L'][m] = self.faces['B'][m][:]
        self.faces['B'][m] = self.faces['R'][m][:]
        self.faces['R'][m] = temp

    # S move: rotates the slice parallel to the F face (affects one cell from U, R, D, L)
    # For 3x3, rotates:
    #   U bottom-middle, L middle-right, D top-middle, R middle-left.
    def move_S(self):
        m = self.n // 2
        n = self.n
        temp = self.faces['U'][n-1][m]
        self.faces['U'][n-1][m] = self.faces['L'][m][n-1]
        self.faces['L'][m][n-1] = self.faces['D'][0][m]
        self.faces['D'][0][m] = self.faces['R'][m][0]
        self.faces['R'][m][0] = temp

    def move_S_cc(self):
        m = self.n // 2
        n = self.n
        temp = self.faces['U'][n-1][m]
        self.faces['U'][n-1][m] = self.faces['R'][m][0]
        self.faces['R'][m][0] = self.faces['D'][0][m]
        self.faces['D'][0][m] = self.faces['L'][m][n-1]
        self.faces['L'][m][n-1] = temp

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
    screen_width, screen_height = 800, 600
    screen = pygame.display.set_mode((screen_width, screen_height))
    pygame.display.set_caption("3D Rubik's Cube Emulator (Pygame Only)")
    clock = pygame.time.Clock()
    
    # Perspective settings
    fov = 256
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
    face_drag_threshold = 30  # pixels
    
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
                                if mods & KMOD_SHIFT:
                                    cube.move_F_cc(); move = "F'"
                                else:
                                    cube.move_F(); move = "F"
                            else:
                                if mods & KMOD_SHIFT:
                                    cube.move_F(); move = "F"
                                else:
                                    cube.move_F_cc(); move = "F'"
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
                    if mods & KMOD_SHIFT:
                        cube.move_U_cc(); move = "U'"
                    else:
                        cube.move_U(); move = "U"
                elif event.key == K_d:
                    if mods & KMOD_SHIFT:
                        cube.move_D_cc(); move = "D'"
                    else:
                        cube.move_D(); move = "D"
                elif event.key == K_f:
                    if mods & KMOD_SHIFT:
                        cube.move_F_cc(); move = "F'"
                    else:
                        cube.move_F(); move = "F"
                elif event.key == K_b:
                    if mods & KMOD_SHIFT:
                        cube.move_B_cc(); move = "B'"
                    else:
                        cube.move_B(); move = "B"
                elif event.key == K_l:
                    if mods & KMOD_SHIFT:
                        cube.move_L_cc(); move = "L'"
                    else:
                        cube.move_L(); move = "L"
                elif event.key == K_r:
                    if mods & KMOD_SHIFT:
                        cube.move_R_cc(); move = "R'"
                    else:
                        cube.move_R(); move = "R"
                elif event.key == K_m:
                    if mods & KMOD_SHIFT:
                        cube.move_M_cc() if hasattr(cube, "move_M_cc") else cube.move_M(); move = "M'"
                    else:
                        cube.move_M(); move = "M"
                elif event.key == K_e:
                    if mods & KMOD_SHIFT:
                        cube.move_E_cc() if hasattr(cube, "move_E_cc") else cube.move_E(); move = "E'"
                    else:
                        cube.move_E(); move = "E"
                elif event.key == K_s:
                    if mods & KMOD_SHIFT:
                        cube.move_S_cc(); move = "S'"
                    else:
                        cube.move_S(); move = "S"
                if move:
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
