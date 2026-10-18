package com.chainlesschain.ide;
import java.io.PrintWriter;
import org.junit.platform.engine.discovery.DiscoverySelectors;
import org.junit.platform.launcher.core.LauncherDiscoveryRequestBuilder;
import org.junit.platform.launcher.core.LauncherFactory;
import org.junit.platform.launcher.listeners.SummaryGeneratingListener;
public final class GoalExtensionCoreTestRunner {
  public static void main(String[] args) {
    var request = LauncherDiscoveryRequestBuilder.request()
        .selectors(DiscoverySelectors.selectClass(PluginManagerTest.class)).build();
    var listener = new SummaryGeneratingListener();
    LauncherFactory.create().execute(request, listener);
    var summary = listener.getSummary();
    summary.printTo(new PrintWriter(System.out, true));
    summary.printFailuresTo(new PrintWriter(System.out, true));
    if (summary.getTestsFoundCount() == 0 || summary.getTestsFailedCount() != 0
        || summary.getTestsAbortedCount() != 0 || summary.getTestsSkippedCount() != 0)
      System.exit(1);
  }
}