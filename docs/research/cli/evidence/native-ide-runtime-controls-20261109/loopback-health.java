import java.net.*;

class LoopbackHealth {
  public static void main(String[] args) throws Exception {
    String[] hosts = {"127.0.0.1", "::1"};
    System.out.print("{\"schema\":\"chainlesschain.java-loopback-control/v1\",\"version\":\""
      + System.getProperty("java.version") + "\",\"extensionLoaded\":false,\"cases\":[");
    for (int i = 0; i < hosts.length; i++) {
      boolean listening = false, connected = false;
      String error = null;
      try (ServerSocket server = new ServerSocket(); Socket client = new Socket()) {
        server.bind(new InetSocketAddress(InetAddress.getByName(hosts[i]), 0));
        server.setSoTimeout(1500);
        listening = true;
        client.connect(new InetSocketAddress(InetAddress.getByName(hosts[i]), server.getLocalPort()), 1500);
        try (Socket accepted = server.accept()) { connected = true; }
      } catch (Exception exception) { error = exception.getClass().getSimpleName(); }
      if (i > 0) System.out.print(",");
      System.out.print("{\"host\":\"" + hosts[i] + "\",\"listening\":" + listening
        + ",\"connected\":" + connected + ",\"error\":" + (error == null ? "null" : "\"" + error + "\"") + "}");
    }
    System.out.println("]}");
  }
}
