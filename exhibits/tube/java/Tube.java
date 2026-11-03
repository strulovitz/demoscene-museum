/*
 * ==============================================================================
 *   TUBE  -  a Java remake of the 256-byte DOS intro "tube" by baze/3SC (2001)
 * ==============================================================================
 *
 * Same program as tube.py, same function names, same five steps:
 *   1. makePalette()   256 colours; pixel values are SIGNED: + = fire, - = teal
 *   2. makeTexture()   256x256 wall texture = light from one side + grain
 *   3. renderTube()    for every pixel: which point of the tunnel do I see?
 *   4. copyToScreen()  pixel numbers -> image -> window
 *   5. fadeOldFrame()  divide everything by 4 -> motion blur trail
 *
 * Java has no numpy, so renderTube() uses two ordinary nested loops
 * (one over rows, one over columns).  Java is fast enough that this still
 * runs at full speed - compare it with the numpy version to see how the
 * "do it for all pixels at once" style maps onto "do it for one pixel".
 *
 * Run:   java Tube.java        (Java 11 or newer, no compile step needed)
 * Quit:  ESC or close the window
 */

import javax.swing.JFrame;
import javax.swing.JPanel;
import javax.swing.Timer;
import java.awt.Dimension;
import java.awt.Graphics;
import java.awt.event.KeyAdapter;
import java.awt.event.KeyEvent;
import java.awt.image.BufferedImage;
import java.awt.image.IndexColorModel;
import java.awt.image.WritableRaster;
import java.util.Random;

public class Tube extends JPanel {

    // ------------------------------------------------------------- constants
    static final int WIDTH = 320, HEIGHT = 200;   // classic VGA "mode 13h"
    static final int TUBE_HEIGHT = 160;           // tunnel drawn in the middle 160 rows
    static final int TOP = (HEIGHT - TUBE_HEIGHT) / 2;

    static final int EYE_DISTANCE = 160;          // "screen" distance from your eye (zoom)
    static final int TEXTURE_SCALE = 41;          // ~128/pi: one turn = one texture width
    static final double ROTATION_SPEED = 0.0238;  // radians per frame
    static final int SCROLL_SPEED = 8;            // texture pixels per frame
    static final int FRAMES_PER_SECOND = 30;

    // ---------------------------------------------------------------- state
    int[][] texture = makeTexture();                        // [row][column]
    int[][] pixels = new int[TUBE_HEIGHT][WIDTH];           // signed -128..127
    BufferedImage image = new BufferedImage(WIDTH, HEIGHT,
            BufferedImage.TYPE_BYTE_INDEXED, makePalette()); // 1 byte per pixel + palette
    double angle = 0.0;
    int scroll = 0;

    Tube() {
        setPreferredSize(new Dimension(WIDTH * 3, HEIGHT * 3));   // window is 3x zoomed
    }

    // ========================================================== 1. palette
    /**
     * A pixel value is treated as a SIGNED number: 0..127 positive, 128..255
     * really mean -128..-1.  Positive = fire (red -> orange -> yellow),
     * negative = cold teal.  When a pixel overflows past 127 it flips to teal:
     * that overflow is the glow effect.
     */
    static IndexColorModel makePalette() {
        byte[] red = new byte[256], green = new byte[256], blue = new byte[256];
        for (int index = 0; index < 256; index++) {
            int value = (index < 128) ? index : index - 256;    // 0..127 or -128..-1
            int r, g, b;
            if (value >= 0) {
                r = 2 * value;                  // grows in a straight line
                g = value * value / 64;         // grows like a curve
                b = 0;
            } else {
                int strength = -value;          // 1..128
                r = 0;
                g = Math.min(255, 2 * strength);
                b = strength;
            }
            // Java's byte is -128..127, but IndexColorModel reads it back as 0..255.
            // The (byte) cast just reinterprets the bits, nothing is lost.
            red[index] = (byte) r;
            green[index] = (byte) g;
            blue[index] = (byte) b;
        }
        return new IndexColorModel(8, 256, red, green, blue);
    }

    // ========================================================== 2. texture
    /**
     * 256x256 brightness values (about 20..100).  Column = angle around the
     * tunnel, row = distance along it.  Two ingredients:
     *   LIGHT: a cosine across the columns -> one side lit, the other dark,
     *          and it joins up seamlessly where the texture wraps around.
     *   GRAIN: a little blurred random noise so the wall looks like concrete.
     */
    static int[][] makeTexture() {
        Random random = new Random(2001);                  // fixed seed = same grain every run
        double[][] grain = new double[256][256];
        for (int row = 0; row < 256; row++)
            for (int col = 0; col < 256; col++)
                grain[row][col] = random.nextDouble() - 0.5;   // TV static, -0.5..0.5

        int[][] texture = new int[256][256];
        for (int row = 0; row < 256; row++) {
            for (int col = 0; col < 256; col++) {
                double light = 60 + 30 * Math.cos((col - 104) * 2 * Math.PI / 256);
                // blur: average with the four neighbours.  "& 255" wraps 256 -> 0
                // and -1 -> 255, so the edges join up.
                double blurred = (grain[row][col]
                        + grain[(row + 1) & 255][col] + grain[(row - 1) & 255][col]
                        + grain[row][(col + 1) & 255] + grain[row][(col - 1) & 255]) / 5;
                texture[row][col] = (int) Math.round(light + 8 * blurred);
            }
        }
        return texture;
    }

    // ========================================================== 3. the tube
    /**
     * For every pixel: it sits on a glass screen EYE_DISTANCE in front of your
     * eye at (x, y).  Where does the line from your eye through that pixel hit
     * the tunnel wall?  The tunnel has radius 1 around the Z axis, so
     *     angle around the tunnel   = atan2(x, y)          -> texture column u
     *     distance along the tunnel = z / sqrt(x^2 + y^2)  -> texture row v
     * First we rotate the scene so the tunnel turns and bends.  The result is
     * ADDED to the (faded) previous frame.
     */
    void renderTube() {
        double c = Math.cos(angle), s = Math.sin(angle);
        for (int row = 0; row < TUBE_HEIGHT; row++) {
            for (int col = 0; col < WIDTH; col++) {
                double x = col - 160, y = row - 80, z = EYE_DISTANCE;  // 0,0 = screen centre

                // rotation 1: spin around the Z axis (the direction you look)
                double x1 = x * c + y * s;
                double y1 = y * c - x * s;
                // rotation 2: turn around the Y axis - this bends the tube
                double x2 = x1 * c + z * s;
                double z2 = z * c - x1 * s;

                double radius = Math.max(Math.sqrt(x2 * x2 + y1 * y1), 0.001);
                int u = (int) Math.round(TEXTURE_SCALE * Math.atan2(x2, y1));
                double depth = TEXTURE_SCALE * z2 / radius;              // huge near the centre
                int v = (int) Math.round(Math.max(-32768, Math.min(32767, depth)));

                // Three layers chosen by a checkerboard test.  "& 64" looks at
                // one bit of the number, which flips every 64 texture pixels,
                // so (u + v) & 64 gives diagonal squares.  Each layer is a
                // different zoom of the texture and a different darkness.
                int colour;
                if (((u + v + scroll) & 64) == 0)
                    colour = texture[(v + scroll) & 255][u & 255] - 5;              // zoom 1x
                else if (((4 * u - 4 * v - scroll) & 128) == 0)
                    colour = texture[(4 * v + scroll) & 255][(4 * u) & 255] - 16;   // zoom 4x
                else
                    colour = texture[(8 * v + scroll) & 255][(8 * u) & 255] - 48;   // zoom 8x

                pixels[row][col] = wrapToSignedByte(pixels[row][col] + colour);
            }
        }
    }

    /**
     * Keep a number in -128..127, wrapping like a car odometer (127 + 1 = -128).
     * Java's "byte" type IS a signed 8-bit number, so the cast does it for us.
     * The wrap-around is what makes the hottest spots flash teal.
     */
    static int wrapToSignedByte(int value) {
        return (byte) value;
    }

    // ========================================================== 5. the fade
    /** Divide every pixel by 4 (">> 2" shifts right 2 bits and keeps the sign).
     *  Done every frame, each drawn image fades out over 3-4 frames. */
    void fadeOldFrame() {
        for (int row = 0; row < TUBE_HEIGHT; row++)
            for (int col = 0; col < WIDTH; col++)
                pixels[row][col] >>= 2;
    }

    // ========================================================== 4. show it
    /** Pixel numbers -> the 8-bit image.  "& 255" turns -1 into 255 etc. */
    void copyToScreen() {
        WritableRaster raster = image.getRaster();
        for (int row = 0; row < TUBE_HEIGHT; row++)
            for (int col = 0; col < WIDTH; col++)
                raster.setSample(col, TOP + row, 0, pixels[row][col] & 255);
    }

    @Override
    protected void paintComponent(Graphics g) {
        super.paintComponent(g);
        // draw the 320x200 image stretched over the whole panel (3x zoom)
        g.drawImage(image, 0, 0, getWidth(), getHeight(), null);
    }

    public static void main(String[] args) {
        Tube tube = new Tube();
        JFrame frame = new JFrame("tube - baze/3SC 2001 - Java remake  (ESC quits)");
        frame.setDefaultCloseOperation(JFrame.EXIT_ON_CLOSE);
        frame.add(tube);
        frame.pack();
        frame.setLocationRelativeTo(null);
        frame.addKeyListener(new KeyAdapter() {
            @Override
            public void keyPressed(KeyEvent e) {
                if (e.getKeyCode() == KeyEvent.VK_ESCAPE) System.exit(0);
            }
        });
        frame.setVisible(true);

        // One frame, FRAMES_PER_SECOND times a second:
        new Timer(1000 / FRAMES_PER_SECOND, e -> {
            tube.angle += ROTATION_SPEED;
            tube.scroll += SCROLL_SPEED;
            tube.renderTube();       // draw on top of the faded old frame
            tube.copyToScreen();
            tube.repaint();          // asks Swing to call paintComponent()
            tube.fadeOldFrame();     // prepare for the next frame
        }).start();
    }
}