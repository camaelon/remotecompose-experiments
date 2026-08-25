package androidx.annotation;
import java.lang.annotation.*;
@Retention(RetentionPolicy.SOURCE)
public @interface VisibleForTesting { int value() default 0; }
