import java.awt.*;
import javax.swing.*;

public final class ApprovalLayoutProbe {
  static JRootPane top;
  static Panel host;
  static JPanel root, southWrap, cards, card;
  static JScrollPane scroll;
  static JButton approve;
  static void edt(Runnable task) throws Exception { SwingUtilities.invokeAndWait(task); }
  static void snapshot(String stage) {
    Dimension preferred=scroll.getPreferredSize();
    System.out.printf("{\"stage\":\"%s\",\"edt\":%s,\"headless\":%s,\"windows\":%d,\"displayable\":%s,\"showing\":%s,\"rootValid\":%s,\"scrollValidateRoot\":%s,\"scrollHeight\":%d,\"scrollPreferredHeight\":%d,\"viewportHeight\":%d,\"cardsHeight\":%d,\"cardsPreferredHeight\":%d,\"approveHeight\":%d,\"approveVisibleHeight\":%d}%n",
      stage,SwingUtilities.isEventDispatchThread(),GraphicsEnvironment.isHeadless(),Window.getWindows().length,top.isDisplayable(),top.isShowing(),top.isValid(),scroll.isValidateRoot(),scroll.getHeight(),preferred.height,scroll.getViewport().getHeight(),cards.getHeight(),cards.getPreferredSize().height,approve==null?0:approve.getHeight(),approve==null?0:approve.getVisibleRect().height);
  }
  static void setup() {
    top=new JRootPane();root=new JPanel(new BorderLayout());top.setContentPane(root);
    root.add(new JPanel(),BorderLayout.CENTER);
    cards=new JPanel();cards.setLayout(new BoxLayout(cards,BoxLayout.Y_AXIS));
    scroll=new JScrollPane(cards){@Override public Dimension getPreferredSize(){Dimension size=super.getPreferredSize();size.height=Math.min(320,size.height);return size;}};
    scroll.setBorder(BorderFactory.createEmptyBorder());scroll.setHorizontalScrollBarPolicy(JScrollPane.HORIZONTAL_SCROLLBAR_NEVER);
    southWrap=new JPanel(new BorderLayout(0,2));southWrap.add(scroll,BorderLayout.NORTH);
    JPanel composer=new JPanel();composer.setPreferredSize(new Dimension(500,100));southWrap.add(composer,BorderLayout.CENTER);
    root.add(southWrap,BorderLayout.SOUTH);host=new Panel(new BorderLayout());host.add(top);host.setSize(800,600);host.addNotify();host.validate();
  }
  static void addApproval() {
    card=new JPanel(new BorderLayout(4,4));card.setBorder(BorderFactory.createLineBorder(Color.ORANGE));
    JLabel text=new JLabel("Allow run_shell? Exact permission scope");text.setPreferredSize(new Dimension(400,90));card.add(text,BorderLayout.CENTER);
    JPanel buttons=new JPanel(new FlowLayout(FlowLayout.RIGHT,4,2));approve=new JButton("Approve Once");buttons.add(approve);buttons.add(new JButton("Deny"));buttons.add(new JButton("Cancel Request"));card.add(buttons,BorderLayout.SOUTH);
    cards.add(card);cards.revalidate();cards.repaint();
  }
  // Controlled scheduling only: a windowless headless hierarchy is excluded
  // from RepaintManager's queue. Select its real nearest validate root and
  // invoke the actual Container.validate() on the EDT. No layout methods,
  // preferred sizes, showing flags, or component bounds are substituted.
  static void flush(JComponent invalid){
    Container selected=invalid;
    while(selected!=null&&!selected.isValidateRoot())selected=selected.getParent();
    if(selected==null)throw new AssertionError("No validate root");
    selected.validate();
  }
  public static void main(String[] args) throws Exception {
    edt(()->{setup();snapshot("empty-initial-layout");});
    edt(()->{addApproval();flush(cards);snapshot("child-only-revalidate");if(scroll.getHeight()!=0||scroll.getPreferredSize().height<=0)throw new AssertionError("Expected stale zero-height card viewport");});
    edt(()->{scroll.revalidate();flush(scroll);snapshot("scroll-only-revalidate");if(scroll.getHeight()!=0)throw new AssertionError("Scroll revalidate unexpectedly resized parent");});
    edt(()->{southWrap.revalidate();flush(southWrap);snapshot("wrapper-revalidate");if(scroll.getHeight()<=0||approve.getHeight()<=0)throw new AssertionError("Wrapper validation did not lay out approval button");});
    edt(()->{host.removeNotify();});
  }
}
