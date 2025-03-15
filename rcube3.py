import sys
import pygame
from pygame.locals import *

# --------------------------
# Utility: rotate a matrix clockwise
# --------------------------
def rotate_matrix_clockwise(mat):
    # Return a new matrix rotated clockwise.
    return [list(row) for row in zip(*mat[::-1])]

# --------------------------
# Cube class definition
# --------------------------
class Cube:
    def __init__(self, n):
        self.n = n
        # Each face is represented as an n x n matrix with a face label.
        # Standard color notation:
        # U (up)=white, D (down)=yellow, F (front)=green, B (back)=blue,
        # L (left)=orange, R (right)=red.
        self.faces = {
            'U': [[ 'U' for _ in range(n)] for _ in range(n)],
            'D': [[ 'D' for _ in range(n)] for _ in range(n)],
            'F': [[ 'F' for _ in range(n)] for _ in range(n)],
            'B': [[ 'B' for _ in range(n)] for _ in range(n)],
            'L': [[ 'L' for _ in range(n)] for _ in range(n)],
            'R': [[ 'R' for _ in range(n)] for _ in range(n)]
        }

    def move_U(self):
        n = self.n
        # Rotate the U face itself.
        self.faces['U'] = rotate_matrix_clockwise(self.faces['U'])
        # Cycle the top rows of F, R, B, L.
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

    def move_F(self):
        n = self.n
        self.faces['F'] = rotate_matrix_clockwise(self.faces['F'])
        # Cycle edges: U bottom row, L right column, D top row, R left column.
        temp = self.faces['U'][n-1][:]
        for i in range(n):
            self.faces['U'][n-1][i] = self.faces['L'][n-1-i][n-1]
            self.faces['L'][n-1-i][n-1] = self.faces['D'][0][n-1-i]
            self.faces['D'][0][n-1-i] = self.faces['R'][i][0]
            self.faces['R'][i][0] = temp[i]

    def move_B(self):
        n = self.n
        self.faces['B'] = rotate_matrix_clockwise(self.faces['B'])
        # Cycle edges: U top row, R right column, D bottom row, L left column.
        temp = self.faces['U'][0][:]
        for i in range(n):
            self.faces['U'][0][i] = self.faces['R'][i][n-1]
            self.faces['R'][i][n-1] = self.faces['D'][n-1][n-1-i]
            self.faces['D'][n-1][n-1-i] = self.faces['L'][i][0]
            self.faces['L'][i][0] = temp[n-1-i]

    def move_L(self):
        n = self.n
        self.faces['L'] = rotate_matrix_clockwise(self.faces['L'])
        # Cycle edges: U left column, B right column, D left column, F left column.
        temp = [self.faces['U'][i][0] for i in range(n)]
        for i in range(n):
            self.faces['U'][i][0] = self.faces['B'][n-1-i][n-1]
            self.faces['B'][n-1-i][n-1] = self.faces['D'][i][0]
            self.faces['D'][i][0] = self.faces['F'][i][0]
            self.faces['F'][i][0] = temp[i]

    def move_R(self):
        n = self.n
        self.faces['R'] = rotate_matrix_clockwise(self.faces['R'])
        # Cycle edges: U right column, F right column, D right column, B left column.
        temp = [self.faces['U'][i][n-1] for i in range(n)]
        for i in range(n):
            self.faces['U'][i][n-1] = self.faces['F'][i][n-1]
            self.faces['F'][i][n-1] = self.faces['D'][i][n-1]
            self.faces['D'][i][n-1] = self.faces['B'][n-1-i][0]
            self.faces['B'][n-1-i][0] = temp[i]

# --------------------------
# Pygame drawing and main loop
# --------------------------
def main():
    # Allow customizable cube size from command line (default 3).
    n = 3
    if len(sys.argv) > 1:
        try:
            n = int(sys.argv[1])
        except:
            pass

    # Define colors for faces (RGB tuples)
    color_map = {
        'U': (255, 255, 255),   # white
        'D': (255, 255, 0),     # yellow
        'F': (0, 255, 0),       # green
        'B': (0, 0, 255),       # blue
        'L': (255, 165, 0),     # orange
        'R': (255, 0, 0)        # red
    }
    # Colors for outlines/background.
    black = (0, 0, 0)
    gray  = (50, 50, 50)

    pygame.init()

    # Set up sizes
    cell_size = 50
    margin = 10
    face_size = n * cell_size
    # Using a common net layout:
    #      U
    # L  F  R  B
    #      D
    win_width = 4 * face_size + 5 * margin
    win_height = 3 * face_size + 4 * margin
    screen = pygame.display.set_mode((win_width, win_height))
    pygame.display.set_caption(f"Customizable {n}x{n} Rubik's Cube Emulator")

    # Determine positions for each face in the net.
    face_positions = {
        'U': (face_size + margin, 0),
        'L': (0, face_size + margin),
        'F': (face_size + margin, face_size + margin),
        'R': (2 * face_size + 2 * margin, face_size + margin),
        'B': (3 * face_size + 3 * margin, face_size + margin),
        'D': (face_size + margin, 2 * face_size + 2 * margin)
    }

    # Create the cube state.
    cube = Cube(n)

    clock = pygame.time.Clock()
    running = True

    while running:
        for event in pygame.event.get():
            if event.type == QUIT:
                running = False
            elif event.type == KEYDOWN:
                # Map key presses to moves (only clockwise moves here).
                if event.key == K_u:
                    cube.move_U()
                elif event.key == K_d:
                    cube.move_D()
                elif event.key == K_f:
                    cube.move_F()
                elif event.key == K_b:
                    cube.move_B()
                elif event.key == K_l:
                    cube.move_L()
                elif event.key == K_r:
                    cube.move_R()

        # Clear screen
        screen.fill(gray)

        # Draw each face.
        for face, pos in face_positions.items():
            x0, y0 = pos
            for i in range(n):
                for j in range(n):
                    color_label = cube.faces[face][i][j]
                    color = color_map.get(color_label, black)
                    rect = pygame.Rect(x0 + j*cell_size, y0 + i*cell_size, cell_size, cell_size)
                    pygame.draw.rect(screen, color, rect)
                    pygame.draw.rect(screen, black, rect, 2)  # black border for clarity

        pygame.display.flip()
        clock.tick(30)

    pygame.quit()

if __name__ == '__main__':
    main()
