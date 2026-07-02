#include <SFML/Graphics.hpp>
#include <iostream>
#include <vector>
#include <array>
#include <string>
#include <cmath>
#include <map>
#include <algorithm>
#include <cstdlib>
#include <sstream>

// ---- Color definitions -------------------------------------------------------
static std::map<char, sf::Color> color_map = {
    {'U', sf::Color::White},
    {'D', sf::Color::Yellow},
    {'F', sf::Color::Green},
    {'B', sf::Color::Blue},
    {'L', sf::Color(255, 165, 0)},  // orange
    {'R', sf::Color::Red}
};

// ---- Helper: rotate matrix clockwise -----------------------------------------
static std::vector<std::vector<char>>
rotate_cw(const std::vector<std::vector<char>>& mat) {
    int n = mat.size();
    std::vector<std::vector<char>> out(n, std::vector<char>(n));
    for (int i = 0; i < n; ++i)
        for (int j = 0; j < n; ++j)
            out[j][n - 1 - i] = mat[i][j];
    return out;
}

// ---- Cube class --------------------------------------------------------------
class Cube {
public:
    int n;
    std::map<char, std::vector<std::vector<char>>> faces;

    explicit Cube(int n_) : n(n_) {
        for (char f : {'U','D','F','B','L','R'})
            faces[f] = std::vector<std::vector<char>>(n, std::vector<char>(n, f));
    }

    void print_cube(const std::string& move = "") const {
        if (!move.empty()) std::cout << "\nPerformed move: " << move << "\n";
        else               std::cout << "\nCube state:\n";
        for (char f : {'U','D','F','B','L','R'}) {
            std::cout << f << " face:\n";
            for (auto& row : faces.at(f)) {
                std::cout << "  ";
                for (char c : row) std::cout << c << ' ';
                std::cout << '\n';
            }
        }
        std::cout << std::string(30, '-') << '\n';
    }

    bool is_solved() const {
        for (char f : {'U','D','F','B','L','R'})
            for (auto& row : faces.at(f))
                for (char c : row)
                    if (c != f) return false;
        return true;
    }

    // ---- Face moves (CW) -----------------------------------------------------
    void move_U() {
        faces['U'] = rotate_cw(faces['U']);
        auto temp = faces['F'][0];
        faces['F'][0] = faces['R'][0];
        faces['R'][0] = faces['B'][0];
        faces['B'][0] = faces['L'][0];
        faces['L'][0] = temp;
    }

    void move_D() {
        faces['D'] = rotate_cw(faces['D']);
        auto temp = faces['F'][n-1];
        faces['F'][n-1] = faces['L'][n-1];
        faces['L'][n-1] = faces['B'][n-1];
        faces['B'][n-1] = faces['R'][n-1];
        faces['R'][n-1] = temp;
    }

    void move_F() {
        faces['F'] = rotate_cw(faces['F']);
        std::vector<char> temp = faces['U'][n-1];
        // U bottom row = rev(L right col)
        for (int i = 0; i < n; ++i) faces['U'][n-1][i] = faces['L'][n-1-i][n-1];
        // L right col = D top row
        for (int i = 0; i < n; ++i) faces['L'][i][n-1] = faces['D'][0][i];
        // D top row = rev(R left col)
        for (int i = 0; i < n; ++i) faces['D'][0][i] = faces['R'][n-1-i][0];
        // R left col = original U bottom row
        for (int i = 0; i < n; ++i) faces['R'][i][0] = temp[i];
    }

    void move_B() {
        faces['B'] = rotate_cw(faces['B']);
        std::vector<char> temp = faces['U'][0];
        // U top row = rev(R right col)
        for (int i = 0; i < n; ++i) faces['U'][0][i] = faces['R'][n-1-i][n-1];
        // R right col = D bottom row
        for (int i = 0; i < n; ++i) faces['R'][i][n-1] = faces['D'][n-1][i];
        // D bottom row = rev(L left col)
        for (int i = 0; i < n; ++i) faces['D'][n-1][i] = faces['L'][n-1-i][0];
        // L left col = original U top row
        for (int i = 0; i < n; ++i) faces['L'][i][0] = temp[i];
    }

    void move_L() {
        faces['L'] = rotate_cw(faces['L']);
        std::vector<char> temp(n);
        for (int i = 0; i < n; ++i) temp[i] = faces['U'][i][0];
        for (int i = 0; i < n; ++i) faces['U'][i][0]       = faces['B'][n-1-i][n-1];
        for (int i = 0; i < n; ++i) faces['B'][n-1-i][n-1] = faces['D'][i][0];
        for (int i = 0; i < n; ++i) faces['D'][i][0]       = faces['F'][i][0];
        for (int i = 0; i < n; ++i) faces['F'][i][0]       = temp[i];
    }

    void move_R() {
        faces['R'] = rotate_cw(faces['R']);
        std::vector<char> temp(n);
        for (int i = 0; i < n; ++i) temp[i] = faces['U'][i][n-1];
        for (int i = 0; i < n; ++i) faces['U'][i][n-1]   = faces['F'][i][n-1];
        for (int i = 0; i < n; ++i) faces['F'][i][n-1]   = faces['D'][i][n-1];
        for (int i = 0; i < n; ++i) faces['D'][i][n-1]   = faces['B'][n-1-i][0];
        for (int i = 0; i < n; ++i) faces['B'][n-1-i][0] = temp[i];
    }

    // ---- Slice moves (odd n only) --------------------------------------------
    void move_M() {
        if (n % 2 == 0) { std::cerr << "M requires odd cube size\n"; return; }
        int m = n / 2;
        for (int i = 0; i < n; ++i) {
            char t = faces['U'][i][m];
            faces['U'][i][m] = faces['F'][i][m];
            faces['F'][i][m] = faces['D'][i][m];
            faces['D'][i][m] = faces['B'][i][m];
            faces['B'][i][m] = t;
        }
    }

    void move_E() {
        if (n % 2 == 0) { std::cerr << "E requires odd cube size\n"; return; }
        int m = n / 2;
        auto temp = faces['F'][m];
        faces['F'][m] = faces['R'][m];
        faces['R'][m] = faces['B'][m];
        faces['B'][m] = faces['L'][m];
        faces['L'][m] = temp;
    }

    void move_S() {
        if (n % 2 == 0) { std::cerr << "S requires odd cube size\n"; return; }
        int m = n / 2;
        char t = faces['U'][n-1][m];
        faces['U'][n-1][m] = faces['L'][m][n-1];
        faces['L'][m][n-1] = faces['D'][0][m];
        faces['D'][0][m]   = faces['R'][m][0];
        faces['R'][m][0]   = t;
    }

    // ---- CCW = 3× CW ---------------------------------------------------------
    void move_U_cc() { for (int i=0;i<3;++i) move_U(); }
    void move_D_cc() { for (int i=0;i<3;++i) move_D(); }
    void move_F_cc() { for (int i=0;i<3;++i) move_F(); }
    void move_B_cc() { for (int i=0;i<3;++i) move_B(); }
    void move_L_cc() { for (int i=0;i<3;++i) move_L(); }
    void move_R_cc() { for (int i=0;i<3;++i) move_R(); }
    void move_M_cc() { for (int i=0;i<3;++i) move_M(); }
    void move_E_cc() { for (int i=0;i<3;++i) move_E(); }
    void move_S_cc() { for (int i=0;i<3;++i) move_S(); }

    // ---- Token-based move application ----------------------------------------
    void apply_move(const std::string& token) {
        bool prime  = !token.empty() && token.back() == '\'';
        bool dbl    = !token.empty() && token.back() == '2';
        std::string base = (prime || dbl) ? token.substr(0, token.size()-1) : token;
        int reps = dbl ? 2 : (prime ? 3 : 1);

        for (int r = 0; r < reps; ++r) {
            if      (base == "U") move_U();
            else if (base == "D") move_D();
            else if (base == "F") move_F();
            else if (base == "B") move_B();
            else if (base == "L") move_L();
            else if (base == "R") move_R();
            else if (base == "M") move_M();
            else if (base == "E") move_E();
            else if (base == "S") move_S();
            else std::cerr << "Unknown move: " << token << '\n';
        }
    }

    void apply_moves(const std::vector<std::string>& tokens) {
        for (auto& t : tokens) apply_move(t);
    }
};

// ---- 3D math ----------------------------------------------------------------
struct Vec3  { double x, y, z; };
struct Proj2 { int x, y; };

static Vec3 rotate_point(Vec3 p, double rot_x, double rot_y) {
    double rx = rot_x * M_PI / 180.0;
    double ry = rot_y * M_PI / 180.0;
    double y1 = p.y * cos(rx) - p.z * sin(rx);
    double z1 = p.y * sin(rx) + p.z * cos(rx);
    double x2 = p.x * cos(ry) + z1 * sin(ry);
    double z2 = -p.x * sin(ry) + z1 * cos(ry);
    return {x2, y1, z2};
}

static Proj2 project_point(Vec3 p, int w, int h, double fov, double dist) {
    double denom = p.z + dist;
    double factor = (std::abs(denom) > 1e-9) ? fov / denom : fov;
    return {(int)(p.x * factor + w * 0.5), (int)(-p.y * factor + h * 0.5)};
}

// ---- Polygon record ---------------------------------------------------------
struct Poly {
    double avg_z;
    std::array<sf::Vector2f, 4> pts;
    sf::Color color;
};

static Vec3 local_to_world(double lx, double ly, Vec3 cen, Vec3 right, Vec3 up) {
    return { cen.x + lx*right.x + ly*up.x,
             cen.y + lx*right.y + ly*up.y,
             cen.z + lx*right.z + ly*up.z };
}

static std::vector<Poly>
get_face_polygons(const std::vector<std::vector<char>>& face, int n,
                  Vec3 center, Vec3 right, Vec3 up,
                  double rot_x, double rot_y, int W, int H, double fov, double dist)
{
    std::vector<Poly> polys;
    double cs = 2.0 / n;
    for (int i = 0; i < n; ++i) {
        for (int j = 0; j < n; ++j) {
            double left  = -1 + j * cs,       right_edge = -1 + (j+1) * cs;
            double top   =  1 - i * cs,       bottom     =  1 - (i+1) * cs;

            auto rp = [&](double lx, double ly) {
                return rotate_point(local_to_world(lx, ly, center, right, up), rot_x, rot_y);
            };
            Vec3 rtl = rp(left, top), rtr = rp(right_edge, top);
            Vec3 rbr = rp(right_edge, bottom), rbl = rp(left, bottom);

            double avg_z = (rtl.z + rtr.z + rbr.z + rbl.z) / 4.0;

            auto pp = [&](Vec3 v) { auto p = project_point(v,W,H,fov,dist); return sf::Vector2f((float)p.x,(float)p.y); };

            char col_ch = face[i][j];
            sf::Color col = color_map.count(col_ch) ? color_map[col_ch] : sf::Color::Black;

            Poly poly;
            poly.avg_z = avg_z;
            poly.pts   = { pp(rtl), pp(rtr), pp(rbr), pp(rbl) };
            poly.color = col;
            polys.push_back(poly);
        }
    }
    return polys;
}

static std::vector<Poly>
accumulate_all_polygons(const Cube& cube,
                        double rot_x, double rot_y,
                        int W, int H, double fov, double dist)
{
    int n = cube.n;
    std::vector<Poly> all;
    struct FaceSpec { char f; Vec3 cen, right, up; };
    std::vector<FaceSpec> specs = {
        {'F', {0,0,1},  {1,0,0},  {0,1,0}},
        {'B', {0,0,-1}, {-1,0,0}, {0,1,0}},
        {'U', {0,1,0},  {1,0,0},  {0,0,-1}},
        {'D', {0,-1,0}, {1,0,0},  {0,0,1}},
        {'L', {-1,0,0}, {0,0,1},  {0,1,0}},
        {'R', {1,0,0},  {0,0,-1}, {0,1,0}},
    };
    for (auto& s : specs) {
        auto pv = get_face_polygons(cube.faces.at(s.f), n, s.cen, s.right, s.up,
                                    rot_x, rot_y, W, H, fov, dist);
        all.insert(all.end(), pv.begin(), pv.end());
    }
    return all;
}

// ---- Scramble via Python solver ----------------------------------------------
static void scramble_cube(Cube& cube) {
    FILE* pipe = popen(
        "python3 -c \"from cube_engine import Cube; from solver import scramble; "
        "c=Cube(3); seq=scramble(c); print(' '.join(seq))\"",
        "r");
    if (!pipe) { std::cerr << "scramble failed\n"; return; }
    char buf[4096]; buf[0] = '\0';
    if (fgets(buf, sizeof(buf), pipe)) {
        pclose(pipe);
        std::istringstream ss(buf);
        std::string tok;
        std::cout << "Scrambled: " << buf;
        while (ss >> tok) cube.apply_move(tok);
    } else {
        pclose(pipe);
    }
}

static void solve_cube(Cube& cube) {
    if (cube.n != 2 && cube.n != 3) {
        std::cout << "Solver only supports 2x2 and 3x3 cubes.\n"; return;
    }
    // Write current state as inline Python, pipe solution back
    std::ostringstream py;
    py << "from cube_engine import Cube; from solver import solve; "
       << "c = Cube(" << cube.n << "); ";
    const char* face_order[] = {"U","D","F","B","L","R"};
    for (const char* f : face_order) {
        for (int i = 0; i < cube.n; ++i)
            for (int j = 0; j < cube.n; ++j)
                py << "c.faces['" << f << "'][" << i << "][" << j
                   << "]='" << cube.faces.at(f[0])[i][j] << "'; ";
    }
    py << "print(' '.join(solve(c)))";

    std::string cmd = std::string("python3 -c \"") + py.str() + "\"";
    FILE* pipe = popen(cmd.c_str(), "r");
    if (!pipe) { std::cerr << "solve failed\n"; return; }
    char buf[16384]; buf[0] = '\0';
    if (fgets(buf, sizeof(buf), pipe)) {
        pclose(pipe);
        std::istringstream ss(buf);
        std::string tok;
        int cnt = 0;
        while (ss >> tok) { cube.apply_move(tok); ++cnt; }
        std::cout << "Solved in " << cnt << " moves.\n";
        cube.print_cube();
    } else {
        pclose(pipe);
        std::cerr << "Solver returned no output.\n";
    }
}

// ---- Main -------------------------------------------------------------------
int main() {
    const int W = 3840, H = 2160;       // 4K UHD
    const double SCALE  = W / 800.0;    // scale relative to 800-wide baseline
    const double FOV    = 256.0 * SCALE;
    const double VDIST  = 4.0;
    const double DRAG_THRESH = 30.0 * SCALE;

    sf::RenderWindow window(sf::VideoMode(W, H), "3D Rubik's Cube (SFML)");
    window.setFramerateLimit(30);

    int cube_dim = 3;
    Cube cube(cube_dim);

    double rot_x = 25.0, rot_y = -30.0;
    double viewer_dist = VDIST;
    double default_rot_x = rot_x, default_rot_y = rot_y;

    bool rotating = false, zooming = false, face_drag = false;
    sf::Vector2i last_mouse, drag_start;
    double zoom_start = viewer_dist;

    sf::Font font;
    bool has_font = font.loadFromFile("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf");
    std::string status_text;

    while (window.isOpen()) {
        sf::Event ev;
        while (window.pollEvent(ev)) {
            if (ev.type == sf::Event::Closed) window.close();

            else if (ev.type == sf::Event::MouseButtonPressed) {
                if (ev.mouseButton.button == sf::Mouse::Left) {
                    rotating = true; last_mouse = {ev.mouseButton.x, ev.mouseButton.y};
                } else if (ev.mouseButton.button == sf::Mouse::Middle) {
                    zooming = true; last_mouse = {ev.mouseButton.x, ev.mouseButton.y};
                    zoom_start = viewer_dist;
                } else if (ev.mouseButton.button == sf::Mouse::Right) {
                    face_drag = true; drag_start = {ev.mouseButton.x, ev.mouseButton.y};
                } else if (ev.mouseButton.button == sf::Mouse::XButton1) {
                    // scroll-up equivalent on some systems
                    cube_dim++; cube = Cube(cube_dim);
                    status_text = "Size: " + std::to_string(cube_dim);
                } else if (ev.mouseButton.button == sf::Mouse::XButton2) {
                    if (cube_dim > 2) { cube_dim--; cube = Cube(cube_dim); }
                    status_text = "Size: " + std::to_string(cube_dim);
                }
            }

            else if (ev.type == sf::Event::MouseWheelScrolled) {
                if (ev.mouseWheelScroll.delta > 0) {
                    cube_dim++; cube = Cube(cube_dim);
                } else if (cube_dim > 2) {
                    cube_dim--; cube = Cube(cube_dim);
                }
                status_text = "Size: " + std::to_string(cube_dim);
            }

            else if (ev.type == sf::Event::MouseButtonReleased) {
                if (ev.mouseButton.button == sf::Mouse::Left) rotating = false;
                else if (ev.mouseButton.button == sf::Mouse::Middle) zooming = false;
                else if (ev.mouseButton.button == sf::Mouse::Right) {
                    if (face_drag) {
                        double dx = ev.mouseButton.x - drag_start.x;
                        bool shift = sf::Keyboard::isKeyPressed(sf::Keyboard::LShift) ||
                                     sf::Keyboard::isKeyPressed(sf::Keyboard::RShift);
                        if (std::abs(dx) > DRAG_THRESH) {
                            std::string mv = (dx > 0) ? (shift ? "F'" : "F")
                                                       : (shift ? "F"  : "F'");
                            cube.apply_move(mv);
                            cube.print_cube(mv);
                        }
                    }
                    face_drag = false;
                }
            }

            else if (ev.type == sf::Event::MouseMoved) {
                if (rotating) {
                    rot_y -= (ev.mouseMove.x - last_mouse.x) * 0.5;
                    rot_x -= (ev.mouseMove.y - last_mouse.y) * 0.5;
                    last_mouse = {ev.mouseMove.x, ev.mouseMove.y};
                }
                if (zooming) {
                    double dy = ev.mouseMove.y - last_mouse.y;
                    viewer_dist = std::max(1.0, zoom_start + dy * 0.02);
                }
            }

            else if (ev.type == sf::Event::KeyPressed) {
                bool shift = sf::Keyboard::isKeyPressed(sf::Keyboard::LShift) ||
                             sf::Keyboard::isKeyPressed(sf::Keyboard::RShift);
                std::string mv;
                bool slice = false;

                switch (ev.key.code) {
                    case sf::Keyboard::W:
                        rot_x=default_rot_x; rot_y=default_rot_y; viewer_dist=VDIST;
                        std::cout << "Camera reset.\n"; break;
                    case sf::Keyboard::U: mv = shift ? "U'" : "U"; break;
                    case sf::Keyboard::D: mv = shift ? "D'" : "D"; break;
                    case sf::Keyboard::F: mv = shift ? "F'" : "F"; break;
                    case sf::Keyboard::B: mv = shift ? "B'" : "B"; break;
                    case sf::Keyboard::L: mv = shift ? "L'" : "L"; break;
                    case sf::Keyboard::R: mv = shift ? "R'" : "R"; break;
                    case sf::Keyboard::M: mv = shift ? "M'" : "M"; slice=true; break;
                    case sf::Keyboard::E: mv = shift ? "E'" : "E"; slice=true; break;
                    case sf::Keyboard::S: mv = shift ? "S'" : "S"; slice=true; break;
                    case sf::Keyboard::Space:
                        scramble_cube(cube); break;
                    case sf::Keyboard::Return:
                        solve_cube(cube); break;
                    default: break;
                }
                if (!mv.empty()) {
                    if (slice && cube_dim % 2 == 0) {
                        std::cout << mv[0] << " moves require odd cube size.\n";
                    } else {
                        cube.apply_move(mv);
                        cube.print_cube(mv);
                    }
                }
            }
        }

        // ---- Render ----------------------------------------------------------
        window.clear(sf::Color(50, 50, 50));

        auto polys = accumulate_all_polygons(cube, rot_x, rot_y, W, H, FOV, viewer_dist);
        std::sort(polys.begin(), polys.end(),
                  [](const Poly& a, const Poly& b){ return a.avg_z > b.avg_z; });

        for (auto& p : polys) {
            sf::ConvexShape shape(4);
            for (int k = 0; k < 4; ++k) shape.setPoint(k, p.pts[k]);
            shape.setFillColor(p.color);
            shape.setOutlineColor(sf::Color::Black);
            shape.setOutlineThickness(1.0f);
            window.draw(shape);
        }

        if (has_font && !status_text.empty()) {
            sf::Text txt(status_text, font, 48);
            txt.setFillColor(sf::Color::White);
            txt.setPosition(20, 20);
            window.draw(txt);
        }

        window.display();
    }
    return 0;
}
