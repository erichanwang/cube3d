#include <SFML/Graphics.hpp>
#include <iostream>
#include <vector>
#include <string>
#include <cmath>
#include <map>
#include <algorithm>

// --- Color definitions ---
std::map<char, sf::Color> color_map = {
    {'U', sf::Color::White},
    {'D', sf::Color::Yellow},
    {'F', sf::Color::Green},
    {'B', sf::Color::Blue},
    {'L', sf::Color(255, 165, 0)},  // orange
    {'R', sf::Color::Red}
};

// --- Helper: Rotate a matrix clockwise ---
std::vector<std::vector<char>> rotate_matrix_clockwise(const std::vector<std::vector<char>>& mat) {
    int n = mat.size();
    std::vector<std::vector<char>> rotated(n, std::vector<char>(n));
    for (int i = 0; i < n; ++i) {
        for (int j = 0; j < n; ++j) {
            rotated[j][n - 1 - i] = mat[i][j];
        }
    }
    return rotated;
}

// --- Cube state class ---
class Cube {
public:
    int n;
    std::map<char, std::vector<std::vector<char>>> faces;

    Cube(int n) : n(n) {
        for (char face : {'U', 'D', 'F', 'B', 'L', 'R'}) {
            faces[face] = std::vector<std::vector<char>>(n, std::vector<char>(n, face));
        }
    }

    void print_cube(const std::string& move = "") {
        if (!move.empty()) {
            std::cout << "\nPerformed move: " << move << std::endl;
        } else {
            std::cout << "\nCube state:" << std::endl;
        }
        for (char face : {'U', 'D', 'F', 'B', 'L', 'R'}) {
            std::cout << face << " face:" << std::endl;
            for (const auto& row : faces[face]) {
                std::cout << "  ";
                for (char c : row) {
                    std::cout << c << " ";
                }
                std::cout << std::endl;
            }
        }
        std::cout << std::string(30, '-') << std::endl;
    }

    // --- Standard face moves (clockwise) ---
    void move_F() {
        faces['F'] = rotate_matrix_clockwise(faces['F']);
        std::vector<char> temp = faces['U'][n - 1];
        std::vector<char> l_right(n);
        for (int i = 0; i < n; ++i) l_right[i] = faces['L'][i][n - 1];
        std::reverse(l_right.begin(), l_right.end());
        faces['U'][n - 1] = l_right;
        for (int i = 0; i < n; ++i) faces['L'][i][n - 1] = faces['D'][0][i];
        std::vector<char> r_left(n);
        for (int i = 0; i < n; ++i) r_left[i] = faces['R'][i][0];
        std::reverse(r_left.begin(), r_left.end());
        faces['D'][0] = r_left;
        for (int i = 0; i < n; ++i) faces['R'][i][0] = temp[i];
    }

    void move_B() {
        faces['B'] = rotate_matrix_clockwise(faces['B']);
        std::vector<char> temp = faces['U'][0];
        std::vector<char> r_right(n);
        for (int i = 0; i < n; ++i) r_right[i] = faces['R'][i][n - 1];
        std::reverse(r_right.begin(), r_right.end());
        faces['U'][0] = r_right;
        for (int i = 0; i < n; ++i) faces['R'][i][n - 1] = faces['D'][n - 1][i];
        std::vector<char> l_left(n);
        for (int i = 0; i < n; ++i) l_left[i] = faces['L'][i][0];
        std::reverse(l_left.begin(), l_left.end());
        faces['D'][n - 1] = l_left;
        for (int i = 0; i < n; ++i) faces['L'][i][0] = temp[i];
    }

    void move_L() {
        faces['L'] = rotate_matrix_clockwise(faces['L']);
        std::vector<char> temp(n);
        for (int i = 0; i < n; ++i) temp[i] = faces['U'][i][0];
        for (int i = 0; i < n; ++i) faces['U'][i][0] = faces['B'][n - 1 - i][n - 1];
        for (int i = 0; i < n; ++i) faces['B'][n - 1 - i][n - 1] = faces['D'][i][0];
        for (int i = 0; i < n; ++i) faces['D'][i][0] = faces['F'][i][0];
        for (int i = 0; i < n; ++i) faces['F'][i][0] = temp[i];
    }

    void move_R() {
        faces['R'] = rotate_matrix_clockwise(faces['R']);
        std::vector<char> temp(n);
        for (int i = 0; i < n; ++i) temp[i] = faces['U'][i][n - 1];
        for (int i = 0; i < n; ++i) faces['U'][i][n - 1] = faces['F'][i][n - 1];
        for (int i = 0; i < n; ++i) faces['F'][i][n - 1] = faces['D'][i][n - 1];
        for (int i = 0; i < n; ++i) faces['D'][i][n - 1] = faces['B'][n - 1 - i][0];
        for (int i = 0; i < n; ++i) faces['B'][n - 1 - i][0] = temp[i];
    }

    void move_U() {
        faces['U'] = rotate_matrix_clockwise(faces['U']);
        std::vector<char> temp = faces['F'][0];
        faces['F'][0] = faces['R'][0];
        faces['R'][0] = faces['B'][0];
        faces['B'][0] = faces['L'][0];
        faces['L'][0] = temp;
    }

    void move_D() {
        faces['D'] = rotate_matrix_clockwise(faces['D']);
        std::vector<char> temp = faces['F'][n - 1];
